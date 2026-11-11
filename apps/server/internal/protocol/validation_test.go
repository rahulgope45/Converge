package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateOperation(t *testing.T) {
	quoted := func(text string) json.RawMessage {
		raw, err := json.Marshal(text)
		if err != nil {
			t.Fatalf("marshal value: %v", err)
		}
		return raw
	}

	tests := []struct {
		name    string
		kind    string
		value   json.RawMessage
		wantErr bool
	}{
		{"plain text", "set_text", quoted("hello\nworld"), false},
		{"empty text", "set_text", quoted(""), false},
		{"10,000 emoji", "set_text", quoted(strings.Repeat("😀", 10000)), false},
		{"10,001 characters", "set_text", quoted(strings.Repeat("a", 10001)), true},
		{"non-string", "set_text", json.RawMessage(`42`), true},
		{"null value", "set_text", json.RawMessage(`null`), true},
		{"NUL character", "set_text", json.RawMessage(`"a\u0000b"`), true},
		{"legacy title", "set_title", quoted("Old"), true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateOperation(Operation{
				OperationID: "7d0c9b0e-5f0a-4c53-9f1b-0c6f6f5a2a11",
				DocumentID:  "27bbbd67-0525-4964-858b-4f0ad065e278",
				ActorID:     "actor-a",
				LogicalTime: 1,
				Kind:        test.kind,
				Value:       test.value,
			})
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateOperation error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}
