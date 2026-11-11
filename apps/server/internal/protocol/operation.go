package protocol

import "encoding/json"

const (
	KindSetText = "set_text"

	// MaxTextLength is counted in Unicode code points.
	MaxTextLength = 10000
)

type Operation struct {
	OperationID string          `json:"operationId"`
	DocumentID  string          `json:"documentId"`
	ActorID     string          `json:"actorId"`
	LogicalTime int64           `json:"logicalTime"`
	Kind        string          `json:"kind"`
	Value       json.RawMessage `json:"value"`
}

type StoredOperation struct {
	ServerSequence int64     `json:"serverSequence"`
	Operation      Operation `json:"operation"`
}
