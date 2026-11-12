package realtime

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/rahulgope45/converge/apps/server/internal/protocol"
)

const (
	frameTypePresence = "presence"
	frameTypeLeave    = "presence_leave"

	maxPresenceNameLength = 40
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// presenceFrame says who a client is and where its caret sits. Anchor is a
// character id, null for the start of the text, or absent for no caret.
type presenceFrame struct {
	Type    string          `json:"type"`
	ActorID string          `json:"actorId"`
	Name    string          `json:"name"`
	Color   string          `json:"color"`
	Anchor  json.RawMessage `json:"anchor,omitempty"`
}

type presenceLeave struct {
	Type    string `json:"type"`
	ActorID string `json:"actorId"`
}

// parsePresence returns the frame and true only for a well-formed presence.
func parsePresence(data []byte) (presenceFrame, bool) {
	var frame presenceFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		return presenceFrame{}, false
	}
	if frame.Type != frameTypePresence {
		return presenceFrame{}, false
	}
	if strings.TrimSpace(frame.ActorID) == "" || len(frame.ActorID) > protocol.MaxActorIDLength {
		return presenceFrame{}, false
	}
	nameLength := utf8.RuneCountInString(frame.Name)
	if strings.TrimSpace(frame.Name) == "" || nameLength > maxPresenceNameLength {
		return presenceFrame{}, false
	}
	if !colorPattern.MatchString(frame.Color) {
		return presenceFrame{}, false
	}

	if frame.Anchor != nil && !bytes.Equal(bytes.TrimSpace(frame.Anchor), []byte("null")) {
		var anchor protocol.CharID
		decoder := json.NewDecoder(bytes.NewReader(frame.Anchor))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&anchor); err != nil {
			return presenceFrame{}, false
		}
		if err := protocol.ValidateCharID(anchor); err != nil {
			return presenceFrame{}, false
		}
	}

	return frame, true
}
