package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rahulgope45/converge/apps/server/internal/protocol"
	"github.com/rahulgope45/converge/apps/server/internal/realtime"
	"github.com/rahulgope45/converge/apps/server/internal/store"
)

const (
	maxRequestBody = 64 << 10
	maxBatchBody   = 1 << 20
	operationLimit = 500
)

type Server struct {
	store          *store.Store
	allowedOrigins map[string]struct{}
	logger         *slog.Logger
	hub            *realtime.Hub
}

func New(
	dataStore *store.Store,
	allowedOrigins map[string]struct{},
	logger *slog.Logger,
) http.Handler {
	server := &Server{
		store:          dataStore,
		allowedOrigins: allowedOrigins,
		logger:         logger,
		hub:            realtime.NewHub(logger),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /ready", server.ready)
	mux.HandleFunc("POST /api/v1/documents", server.createDocument)
	mux.HandleFunc("POST /api/v1/documents/{documentId}/operations", server.submitOperation)
	mux.HandleFunc("POST /api/v1/documents/{documentId}/operations/batch", server.submitBatch)
	mux.HandleFunc("GET /api/v1/documents/{documentId}/operations", server.listOperations)
	mux.HandleFunc("GET /api/v1/documents/{documentId}/stream", server.streamOperations)

	return server.cors(server.requestLog(mux))
}

func (s *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) ready(writer http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()

	if err := s.store.Ping(ctx); err != nil {
		writeError(writer, http.StatusServiceUnavailable, "not_ready", "database is unavailable")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) createDocument(writer http.ResponseWriter, request *http.Request) {
	documentID, err := s.store.CreateDocument(request.Context())
	if err != nil {
		s.logger.Error("create document", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "could not create document")
		return
	}

	writeJSON(writer, http.StatusCreated, map[string]string{"documentId": documentID})
}

func (s *Server) submitOperation(writer http.ResponseWriter, request *http.Request) {
	documentID := request.PathValue("documentId")
	if _, err := uuid.Parse(documentID); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_document_id", "documentId must be a UUID")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBody)
	operation, err := protocol.DecodeOperation(request.Body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "request body too large") {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(writer, status, "invalid_operation", err.Error())
		return
	}
	if operation.DocumentID != documentID {
		writeError(writer, http.StatusBadRequest, "document_id_mismatch", "path and operation document IDs must match")
		return
	}

	result, err := s.store.StoreOperation(request.Context(), operation)
	if errors.Is(err, store.ErrDocumentNotFound) {
		writeError(writer, http.StatusNotFound, "document_not_found", "document does not exist")
		return
	}
	if errors.Is(err, store.ErrOperationConflict) {
		writeError(writer, http.StatusConflict, "operation_id_conflict", err.Error())
		return
	}
	if err != nil {
		s.logger.Error("store operation", "operation_id", operation.OperationID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "could not store operation")
		return
	}

	status := http.StatusCreated
	if result.Duplicate {
		status = http.StatusOK
	} else {
		s.hub.Broadcast(documentID, protocol.StoredOperation{
			ServerSequence: result.ServerSequence,
			Operation:      operation,
		})
	}
	writeJSON(writer, status, map[string]any{
		"operationId":    operation.OperationID,
		"serverSequence": result.ServerSequence,
		"duplicate":      result.Duplicate,
	})
}

// submitBatch stores several operations in order. Every operation is
// validated before any is stored. Storing is idempotent per operation, so a
// client whose batch fails part-way simply sends the whole batch again.
func (s *Server) submitBatch(writer http.ResponseWriter, request *http.Request) {
	documentID := request.PathValue("documentId")
	if _, err := uuid.Parse(documentID); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_document_id", "documentId must be a UUID")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maxBatchBody)
	operations, err := protocol.DecodeBatch(request.Body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "request body too large") {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(writer, status, "invalid_operation", err.Error())
		return
	}
	for _, operation := range operations {
		if operation.DocumentID != documentID {
			writeError(writer, http.StatusBadRequest, "document_id_mismatch", "path and operation document IDs must match")
			return
		}
	}

	results := make([]map[string]any, 0, len(operations))
	for _, operation := range operations {
		result, err := s.store.StoreOperation(request.Context(), operation)
		if errors.Is(err, store.ErrDocumentNotFound) {
			writeError(writer, http.StatusNotFound, "document_not_found", "document does not exist")
			return
		}
		if errors.Is(err, store.ErrOperationConflict) {
			writeError(writer, http.StatusConflict, "operation_id_conflict", err.Error())
			return
		}
		if err != nil {
			s.logger.Error("store operation", "operation_id", operation.OperationID, "error", err)
			writeError(writer, http.StatusInternalServerError, "internal_error", "could not store operation")
			return
		}

		if !result.Duplicate {
			s.hub.Broadcast(documentID, protocol.StoredOperation{
				ServerSequence: result.ServerSequence,
				Operation:      operation,
			})
		}
		results = append(results, map[string]any{
			"operationId":    operation.OperationID,
			"serverSequence": result.ServerSequence,
			"duplicate":      result.Duplicate,
		})
	}

	writeJSON(writer, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) streamOperations(writer http.ResponseWriter, request *http.Request) {
	documentID := request.PathValue("documentId")
	if _, err := uuid.Parse(documentID); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_document_id", "documentId must be a UUID")
		return
	}

	exists, err := s.store.DocumentExists(request.Context(), documentID)
	if err != nil {
		s.logger.Error("check stream document", "document_id", documentID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "could not open stream")
		return
	}
	if !exists {
		writeError(writer, http.StatusNotFound, "document_not_found", "document does not exist")
		return
	}

	if err := s.hub.Serve(writer, request, documentID); !realtime.IsNormalClose(err) {
		s.logger.Warn("websocket ended", "document_id", documentID, "error", err)
	}
}

func (s *Server) listOperations(writer http.ResponseWriter, request *http.Request) {
	documentID := request.PathValue("documentId")
	if _, err := uuid.Parse(documentID); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_document_id", "documentId must be a UUID")
		return
	}

	after := int64(0)
	if value := request.URL.Query().Get("after"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 0 {
			writeError(writer, http.StatusBadRequest, "invalid_cursor", "after must be a non-negative integer")
			return
		}
		after = parsed
	}

	operations, err := s.store.ListOperations(request.Context(), documentID, after, operationLimit+1)
	if errors.Is(err, store.ErrDocumentNotFound) {
		writeError(writer, http.StatusNotFound, "document_not_found", "document does not exist")
		return
	}
	if err != nil {
		s.logger.Error("list operations", "document_id", documentID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "could not list operations")
		return
	}

	hasMore := len(operations) > operationLimit
	if hasMore {
		operations = operations[:operationLimit]
	}
	lastSequence := after
	if len(operations) > 0 {
		lastSequence = operations[len(operations)-1].ServerSequence
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"operations":         operations,
		"lastServerSequence": lastSequence,
		"hasMore":            hasMore,
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		if origin != "" {
			if _, allowed := s.allowedOrigins[origin]; !allowed {
				writeError(writer, http.StatusForbidden, "origin_not_allowed", "origin is not allowed")
				return
			}
			writer.Header().Set("Access-Control-Allow-Origin", origin)
			writer.Header().Set("Vary", "Origin")
			writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}

		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		next.ServeHTTP(writer, request)
		s.logger.Info("request",
			"method", request.Method,
			"path", request.URL.Path,
			"duration_ms", time.Since(started).Milliseconds(),
		)
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		slog.Error("encode response", "error", err)
	}
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}
