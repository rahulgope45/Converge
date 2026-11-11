package protocol

import "encoding/json"

const (
	KindInsertText = "insert_text"
	KindDeleteText = "delete_text"

	// MaxTextLength limits one insert and one delete span, in Unicode code points.
	MaxTextLength    = 10000
	MaxDeleteSpans   = 1000
	MaxBatchSize     = 100
	MaxActorIDLength = 100
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

// CharID identifies one character of a document.
type CharID struct {
	LogicalTime *int64 `json:"logicalTime"`
	ActorID     string `json:"actorId"`
}

type insertValue struct {
	After *CharID `json:"after"`
	Text  *string `json:"text"`
}

type deleteSpan struct {
	ActorID string `json:"actorId"`
	From    *int64 `json:"from"`
	Length  int64  `json:"length"`
}

type deleteValue struct {
	Spans []deleteSpan `json:"spans"`
}

type batch struct {
	Operations []Operation `json:"operations"`
}
