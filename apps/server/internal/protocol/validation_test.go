package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const (
	testOperationID = "7d0c9b0e-5f0a-4c53-9f1b-0c6f6f5a2a11"
	testDocumentID  = "27bbbd67-0525-4964-858b-4f0ad065e278"
)

func insertJSON(after string, text string) json.RawMessage {
	encoded, _ := json.Marshal(text)
	return json.RawMessage(fmt.Sprintf(`{"after":%s,"text":%s}`, after, encoded))
}

func TestValidateOperation(t *testing.T) {
	manySpans := "[" + strings.TrimSuffix(strings.Repeat(`{"actorId":"a","from":1,"length":1},`, 1001), ",") + "]"

	tests := []struct {
		name    string
		kind    string
		value   string
		wantErr bool
	}{
		{"insert at start", "insert_text", string(insertJSON("null", "hello\nworld")), false},
		{"insert after a character", "insert_text", string(insertJSON(`{"logicalTime":4,"actorId":"actor-b"}`, "x")), false},
		{"insert 10,000 emoji", "insert_text", string(insertJSON("null", strings.Repeat("😀", 10000))), false},
		{"insert without after", "insert_text", `{"text":"x"}`, false},
		{"insert empty text", "insert_text", string(insertJSON("null", "")), true},
		{"insert 10,001 characters", "insert_text", string(insertJSON("null", strings.Repeat("a", 10001))), true},
		{"insert NUL character", "insert_text", `{"after":null,"text":"a\u0000b"}`, true},
		{"insert null text", "insert_text", `{"after":null,"text":null}`, true},
		{"insert missing text", "insert_text", `{"after":null}`, true},
		{"insert after negative time", "insert_text", string(insertJSON(`{"logicalTime":-1,"actorId":"a"}`, "x")), true},
		{"insert after empty actor", "insert_text", string(insertJSON(`{"logicalTime":1,"actorId":""}`, "x")), true},
		{"insert after missing time", "insert_text", string(insertJSON(`{"actorId":"a"}`, "x")), true},
		{"insert unknown field", "insert_text", `{"after":null,"text":"x","extra":1}`, true},
		{"insert plain string", "insert_text", `"hello"`, true},

		{"delete one span", "delete_text", `{"spans":[{"actorId":"a","from":3,"length":2}]}`, false},
		{"delete two spans", "delete_text", `{"spans":[{"actorId":"a","from":0,"length":1},{"actorId":"b","from":9,"length":9999}]}`, false},
		{"delete total length too long", "delete_text", `{"spans":[{"actorId":"a","from":0,"length":1},{"actorId":"b","from":9,"length":10000}]}`, true},
		{"delete no spans", "delete_text", `{"spans":[]}`, true},
		{"delete missing spans", "delete_text", `{}`, true},
		{"delete zero length", "delete_text", `{"spans":[{"actorId":"a","from":3,"length":0}]}`, true},
		{"delete length too long", "delete_text", `{"spans":[{"actorId":"a","from":3,"length":10001}]}`, true},
		{"delete negative from", "delete_text", `{"spans":[{"actorId":"a","from":-1,"length":1}]}`, true},
		{"delete missing from", "delete_text", `{"spans":[{"actorId":"a","length":1}]}`, true},
		{"delete empty actor", "delete_text", `{"spans":[{"actorId":"","from":1,"length":1}]}`, true},
		{"delete 1,001 spans", "delete_text", `{"spans":` + manySpans + `}`, true},
		{"delete unknown field", "delete_text", `{"spans":[{"actorId":"a","from":1,"length":1,"x":1}]}`, true},

		{"whole-text kind", "set_text", `"hello"`, true},
		{"incident kind", "set_title", `"Old"`, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateOperation(Operation{
				OperationID: testOperationID,
				DocumentID:  testDocumentID,
				ActorID:     "actor-a",
				LogicalTime: 1,
				Kind:        test.kind,
				Value:       json.RawMessage(test.value),
			})
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateOperation error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func batchOperation(index int, value string) string {
	return fmt.Sprintf(
		`{"operationId":"7d0c9b0e-5f0a-4c53-9f1b-%012d","documentId":%q,"actorId":"actor-a","logicalTime":%d,"kind":"insert_text","value":%s}`,
		index, testDocumentID, index+1, value,
	)
}

func batchBody(count int, invalidAt int) string {
	operations := make([]string, count)
	for index := range operations {
		value := `{"after":null,"text":"x"}`
		if index == invalidAt {
			value = `{"after":null,"text":""}`
		}
		operations[index] = batchOperation(index, value)
	}
	return `{"operations":[` + strings.Join(operations, ",") + `]}`
}

func TestDecodeBatch(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		want    int
		wantErr bool
	}{
		{"one operation", batchBody(1, -1), 1, false},
		{"one hundred operations", batchBody(100, -1), 100, false},
		{"no operations", `{"operations":[]}`, 0, true},
		{"missing list", `{}`, 0, true},
		{"one hundred and one operations", batchBody(101, -1), 0, true},
		{"one invalid among valid", batchBody(5, 3), 0, true},
		{"unknown field", `{"operations":[` + batchOperation(0, `{"after":null,"text":"x"}`) + `],"extra":true}`, 0, true},
		{"trailing data", batchBody(1, -1) + `{}`, 0, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			operations, err := DecodeBatch(strings.NewReader(test.body))
			if (err != nil) != test.wantErr {
				t.Fatalf("DecodeBatch error = %v, wantErr %v", err, test.wantErr)
			}
			if err == nil && len(operations) != test.want {
				t.Fatalf("DecodeBatch returned %d operations, want %d", len(operations), test.want)
			}
		})
	}
}

// PostgreSQL returns JSONB with its own key order and spacing, so a retried
// operation must compare equal to its stored form regardless of layout.
func TestEqualJSON(t *testing.T) {
	tests := []struct {
		name  string
		left  string
		right string
		want  bool
	}{
		{"same bytes", `{"after":null,"text":"x"}`, `{"after":null,"text":"x"}`, true},
		{"different key order and spacing", `{"after":null,"text":"x"}`, `{"text": "x", "after": null}`, true},
		{"escaped and literal characters", `{"text":"é"}`, `{"text":"é"}`, true},
		{"nested objects", `{"after":{"logicalTime":4,"actorId":"a"},"text":"x"}`, `{"text":"x","after":{"actorId":"a","logicalTime":4}}`, true},
		{"different text", `{"after":null,"text":"x"}`, `{"after":null,"text":"y"}`, false},
		{"different span order", `{"spans":[{"actorId":"a","from":1,"length":1},{"actorId":"b","from":1,"length":1}]}`, `{"spans":[{"actorId":"b","from":1,"length":1},{"actorId":"a","from":1,"length":1}]}`, false},
		{"invalid json", `{`, `{`, false},
		{"integers above 2^53 that differ", `{"from":9007199254740993}`, `{"from":9007199254740992}`, false},
		{"same number written differently", `{"from":100}`, `{"from":1e2}`, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := EqualJSON(json.RawMessage(test.left), json.RawMessage(test.right)); got != test.want {
				t.Fatalf("EqualJSON = %v, want %v", got, test.want)
			}
		})
	}
}
