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

// Large enough for a full batch of operations (protocol.MaxBatchSize)
// broadcast at once, with room for presence around it.
const outboundQueueSize = 256

type client struct {
	connection *websocket.Conn
	outbound   chan []byte
	closeOnce  sync.Once

	// Guarded by Hub.mu. Set once the client has announced itself.
	actorID  string
	presence []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*client]struct{}
	logger  *slog.Logger

	// Each connection is pinged every pingInterval and dropped when no pong
	// arrives within pingTimeout. Set before the first connection.
	pingInterval time.Duration
	pingTimeout  time.Duration
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients:      make(map[string]map[*client]struct{}),
		logger:       logger,
		pingInterval: 15 * time.Second,
		pingTimeout:  10 * time.Second,
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

	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()

	go func() {
		if err := connectedClient.writeLoop(ctx); err != nil {
			connectedClient.drop()
		}
	}()
	go h.keepAlive(ctx, connectedClient)

	for {
		_, data, err := connection.Read(ctx)
		if err != nil {
			return err
		}
		// Presence is the only thing clients send. Anything else is ignored
		// rather than treated as an error, so a confused client keeps its
		// operation stream.
		if frame, ok := parsePresence(data); ok {
			h.updatePresence(documentID, connectedClient, frame)
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
	clients := h.othersLocked(documentID, nil)
	h.mu.RUnlock()

	h.send(documentID, clients, message)
}

// othersLocked returns the room's clients except `except`. The caller holds h.mu.
func (h *Hub) othersLocked(documentID string, except *client) []*client {
	room := h.clients[documentID]
	clients := make([]*client, 0, len(room))
	for connectedClient := range room {
		if connectedClient != except {
			clients = append(clients, connectedClient)
		}
	}
	return clients
}

func (h *Hub) send(documentID string, clients []*client, message []byte) {
	for _, connectedClient := range clients {
		select {
		case connectedClient.outbound <- message:
		default:
			h.logger.Warn("closing slow websocket client", "document_id", documentID)
			// Without a close handshake: this client is not reading, and
			// waiting for it would stall whoever is sending.
			connectedClient.drop()
		}
	}
}

// updatePresence remembers a client's latest presence and relays it to the
// other clients in the room. Presence is never stored.
func (h *Hub) updatePresence(documentID string, sender *client, frame presenceFrame) {
	message, err := json.Marshal(frame)
	if err != nil {
		h.logger.Error("encode presence", "error", err)
		return
	}

	h.mu.Lock()
	sender.actorID = frame.ActorID
	sender.presence = message
	others := h.othersLocked(documentID, sender)
	h.mu.Unlock()

	h.send(documentID, others, message)
}

func (h *Hub) register(documentID string, connectedClient *client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// A newcomer learns who is already here. The outbound queue is empty at
	// this point; presences beyond its capacity are skipped and arrive with
	// that peer's next update.
	for existing := range h.clients[documentID] {
		if existing.presence == nil {
			continue
		}
		select {
		case connectedClient.outbound <- existing.presence:
		default:
		}
	}

	if h.clients[documentID] == nil {
		h.clients[documentID] = make(map[*client]struct{})
	}
	h.clients[documentID][connectedClient] = struct{}{}
}

func (h *Hub) unregister(documentID string, connectedClient *client) {
	h.mu.Lock()
	delete(h.clients[documentID], connectedClient)
	if len(h.clients[documentID]) == 0 {
		delete(h.clients, documentID)
	}
	actorID := connectedClient.actorID
	announced := connectedClient.presence != nil
	others := h.othersLocked(documentID, nil)
	h.mu.Unlock()

	if !announced {
		return
	}
	message, err := json.Marshal(presenceLeave{Type: frameTypeLeave, ActorID: actorID})
	if err != nil {
		h.logger.Error("encode presence leave", "error", err)
		return
	}
	h.send(documentID, others, message)
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

// drop closes the connection at once, without a close handshake.
func (connectedClient *client) drop() {
	connectedClient.closeOnce.Do(func() {
		_ = connectedClient.connection.CloseNow()
	})
}

// keepAlive pings the client until ctx ends and drops it when a pong does
// not arrive in time, so a peer whose network vanished is noticed and its
// leave announced. The pong is read by the Read loop in Serve.
func (h *Hub) keepAlive(ctx context.Context, connectedClient *client) {
	ticker := time.NewTicker(h.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingContext, cancel := context.WithTimeout(ctx, h.pingTimeout)
			err := connectedClient.connection.Ping(pingContext)
			cancel()
			if err != nil {
				connectedClient.drop()
				return
			}
		}
	}
}

func IsNormalClose(err error) bool {
	return err == nil ||
		errors.Is(err, context.Canceled) ||
		websocket.CloseStatus(err) == websocket.StatusNormalClosure ||
		websocket.CloseStatus(err) == websocket.StatusGoingAway
}
