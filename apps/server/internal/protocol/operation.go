package protocol

import "encoding/json"

const (
	KindSetTitle    = "set_title"
	KindSetStatus   = "set_status"
	KindSetSeverity = "set_severity"
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
