package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/rahulgope45/converge/apps/server/internal/protocol"
)

const outboundQueueSize = 64

type client struct {
	connection *websocket.Conn
	outbound   chan []byte
	closeOnce  sync.Once
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*client]struct{}
	logger  *slog.Logger
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients: make(map[string]map[*client]struct{}),
		logger:  logger,
	}
}

func (h *Hub) Serve(
	writer http.ResponseWriter,
	request *http.Request,
	documentID string,
) error {
	connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{
		// The HTTP middleware validates the exact Origin before this point.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return err
	}

	connection.SetReadLimit(1024)
	connectedClient := &client{
		connection: connection,
		outbound:   make(chan []byte, outboundQueueSize),
	}
	h.register(documentID, connectedClient)
	defer func() {
		h.unregister(documentID, connectedClient)
		connectedClient.close(websocket.StatusNormalClosure, "connection closed")
	}()

	h.logger.Info("websocket connected", "document_id", documentID)
	defer h.logger.Info("websocket disconnected", "document_id", documentID)

	go func() {
		if err := connectedClient.writeLoop(request.Context()); err != nil {
			connectedClient.close(websocket.StatusInternalError, "write failed")
		}
	}()

	for {
		_, _, err := connection.Read(request.Context())
		if err != nil {
			return err
		}
	}
}

func (h *Hub) Broadcast(documentID string, operation protocol.StoredOperation) {
	message, err := json.Marshal(operation)
	if err != nil {
		h.logger.Error("encode websocket operation", "error", err)
		return
	}

	h.mu.RLock()
	room := h.clients[documentID]
	clients := make([]*client, 0, len(room))
	for connectedClient := range room {
		clients = append(clients, connectedClient)
	}
	h.mu.RUnlock()

	for _, connectedClient := range clients {
		select {
		case connectedClient.outbound <- message:
		default:
			h.logger.Warn("closing slow websocket client", "document_id", documentID)
			connectedClient.close(websocket.StatusPolicyViolation, "outbound queue full")
		}
	}
}

func (h *Hub) register(documentID string, connectedClient *client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.clients[documentID] == nil {
		h.clients[documentID] = make(map[*client]struct{})
	}
	h.clients[documentID][connectedClient] = struct{}{}
}

func (h *Hub) unregister(documentID string, connectedClient *client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.clients[documentID], connectedClient)
	if len(h.clients[documentID]) == 0 {
		delete(h.clients, documentID)
	}
}

func (connectedClient *client) writeLoop(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case message := <-connectedClient.outbound:
			writeContext, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := connectedClient.connection.Write(writeContext, websocket.MessageText, message)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (connectedClient *client) close(status websocket.StatusCode, reason string) {
	connectedClient.closeOnce.Do(func() {
		_ = connectedClient.connection.Close(status, reason)
	})
}

func IsNormalClose(err error) bool {
	return err == nil ||
		errors.Is(err, context.Canceled) ||
		websocket.CloseStatus(err) == websocket.StatusNormalClosure ||
		websocket.CloseStatus(err) == websocket.StatusGoingAway
}
