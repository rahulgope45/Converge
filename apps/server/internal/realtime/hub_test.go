package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/rahulgope45/converge/apps/server/internal/protocol"
)

const testRoom = "room-1"

type testServer struct {
	hub *Hub
	url string
}

func newTestServer(t *testing.T) testServer {
	t.Helper()
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_ = hub.Serve(writer, request, testRoom)
	}))
	t.Cleanup(server.Close)
	return testServer{hub: hub, url: "ws" + strings.TrimPrefix(server.URL, "http")}
}

// join connects a client and waits until the hub has registered it, so that
// frames sent afterwards are relayed to it.
func (s testServer) join(t *testing.T) *websocket.Conn {
	t.Helper()
	before := s.hub.roomSize(testRoom)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, s.url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = connection.CloseNow() })

	deadline := time.Now().Add(2 * time.Second)
	for s.hub.roomSize(testRoom) != before+1 {
		if time.Now().After(deadline) {
			t.Fatal("client was not registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	return connection
}

func send(t *testing.T, connection *websocket.Conn, message string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := connection.Write(ctx, websocket.MessageText, []byte(message)); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func receive(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, data, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var message map[string]any
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatalf("decode %q: %v", data, err)
	}
	return message
}

func expectSilence(t *testing.T, connection *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if _, data, err := connection.Read(ctx); err == nil {
		t.Fatalf("expected no frame, got %q", data)
	}
}

const alicePresence = `{"type":"presence","actorId":"alice","name":"Guest a1","color":"#1f77b4","anchor":{"logicalTime":7,"actorId":"bob"}}`

func TestPresenceIsRelayedToOtherClientsOnly(t *testing.T) {
	server := newTestServer(t)
	alice := server.join(t)
	bob := server.join(t)

	send(t, alice, alicePresence)

	message := receive(t, bob)
	if message["type"] != "presence" || message["actorId"] != "alice" ||
		message["name"] != "Guest a1" || message["color"] != "#1f77b4" {
		t.Fatalf("unexpected presence: %v", message)
	}
	anchor, ok := message["anchor"].(map[string]any)
	if !ok || anchor["logicalTime"] != float64(7) || anchor["actorId"] != "bob" {
		t.Fatalf("unexpected anchor: %v", message["anchor"])
	}

	send(t, bob, `{"type":"presence","actorId":"bob","name":"Guest b2","color":"#ff7f0e","anchor":null}`)
	if echo := receive(t, alice); echo["actorId"] != "bob" {
		t.Fatalf("alice should only receive bob's presence, got %v", echo)
	}
}

func TestLatestPresenceIsReplayedToLateJoiner(t *testing.T) {
	server := newTestServer(t)
	alice := server.join(t)
	bob := server.join(t)

	send(t, alice, `{"type":"presence","actorId":"alice","name":"Guest a1","color":"#1f77b4"}`)
	receive(t, bob)
	send(t, alice, alicePresence)
	receive(t, bob)

	carol := server.join(t)
	message := receive(t, carol)
	if message["actorId"] != "alice" || message["anchor"] == nil {
		t.Fatalf("late joiner should receive alice's latest presence, got %v", message)
	}
}

func TestLeaveIsAnnouncedWhenClientDisconnects(t *testing.T) {
	server := newTestServer(t)
	alice := server.join(t)
	bob := server.join(t)

	send(t, alice, alicePresence)
	receive(t, bob)
	_ = alice.CloseNow()

	message := receive(t, bob)
	if message["type"] != "presence_leave" || message["actorId"] != "alice" {
		t.Fatalf("unexpected leave: %v", message)
	}
}

func TestClientWithoutPresenceLeavesSilently(t *testing.T) {
	server := newTestServer(t)
	alice := server.join(t)
	bob := server.join(t)

	_ = alice.CloseNow()

	expectSilence(t, bob)
}

func TestMalformedFramesAreIgnored(t *testing.T) {
	server := newTestServer(t)
	alice := server.join(t)
	bob := server.join(t)

	for _, frame := range []string{
		`not json`,
		`{"type":"other"}`,
		`{"type":"presence","actorId":"","name":"x","color":"#1f77b4"}`,
		`{"type":"presence","actorId":"alice","name":"","color":"#1f77b4"}`,
		`{"type":"presence","actorId":"alice","name":"` + strings.Repeat("n", 41) + `","color":"#1f77b4"}`,
		`{"type":"presence","actorId":"alice","name":"x","color":"red"}`,
		`{"type":"presence","actorId":"alice","name":"x","color":"#1f77b4","anchor":{"logicalTime":-1,"actorId":"bob"}}`,
		`{"type":"presence","actorId":"alice","name":"x","color":"#1f77b4","anchor":"start"}`,
	} {
		send(t, alice, frame)
	}
	send(t, alice, alicePresence)

	if message := receive(t, bob); message["name"] != "Guest a1" {
		t.Fatalf("only the valid presence should arrive, got %v", message)
	}
	expectSilence(t, bob)
}

func (h *Hub) roomSize(documentID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[documentID])
}

func TestUnresponsivePeerIsDroppedAndItsLeaveAnnounced(t *testing.T) {
	server := newTestServer(t)
	server.hub.pingInterval = 50 * time.Millisecond
	server.hub.pingTimeout = 100 * time.Millisecond

	observer := server.join(t)
	// This client never reads, so it never answers a ping: the same as a
	// peer whose network vanished without closing the connection.
	silent := server.join(t)
	send(t, silent, `{"type":"presence","actorId":"silent","name":"Silent Fox","color":"#2563eb"}`)

	if frame := receive(t, observer); frame["type"] != "presence" {
		t.Fatalf("frame = %v, want presence", frame)
	}
	frame := receive(t, observer)
	if frame["type"] != "presence_leave" || frame["actorId"] != "silent" {
		t.Fatalf("frame = %v, want presence_leave for silent", frame)
	}
}

func TestSlowClientIsDroppedWithoutBlockingTheSender(t *testing.T) {
	server := newTestServer(t)
	// Never reads, so its queue fills and a close handshake gets no answer.
	_ = server.join(t)

	operation := protocol.StoredOperation{Operation: protocol.Operation{
		Kind:  protocol.KindInsertText,
		Value: json.RawMessage(`{"after":null,"text":"` + strings.Repeat("x", 60000) + `"}`),
	}}
	var slowest time.Duration
	for range 2000 {
		started := time.Now()
		server.hub.Broadcast(testRoom, operation)
		slowest = max(slowest, time.Since(started))
		if server.hub.roomSize(testRoom) == 0 {
			break
		}
	}

	if slowest > 500*time.Millisecond {
		t.Fatalf("a broadcast blocked for %v", slowest)
	}
	deadline := time.Now().Add(2 * time.Second)
	for server.hub.roomSize(testRoom) != 0 {
		if time.Now().After(deadline) {
			t.Fatal("slow client is still registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
