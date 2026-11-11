package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

func DecodeOperation(reader io.Reader) (Operation, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	var operation Operation
	if err := decoder.Decode(&operation); err != nil {
		return Operation{}, fmt.Errorf("decode operation: %w", err)
	}

	if err := ensureJSONEnd(decoder); err != nil {
		return Operation{}, err
	}

	if err := ValidateOperation(operation); err != nil {
		return Operation{}, err
	}

	return operation, nil
}

func ValidateOperation(operation Operation) error {
	if _, err := uuid.Parse(operation.OperationID); err != nil {
		return errors.New("operationId must be a UUID")
	}
	if _, err := uuid.Parse(operation.DocumentID); err != nil {
		return errors.New("documentId must be a UUID")
	}

	actorID := strings.TrimSpace(operation.ActorID)
	if actorID == "" || len(actorID) > 100 {
		return errors.New("actorId must contain 1 to 100 characters")
	}
	if operation.LogicalTime < 0 {
		return errors.New("logicalTime must be non-negative")
	}

	switch operation.Kind {
	case KindSetText:
		var text *string
		if err := json.Unmarshal(operation.Value, &text); err != nil || text == nil {
			return errors.New("set_text value must be a string")
		}
		if strings.ContainsRune(*text, 0) {
			return errors.New("text must not contain NUL characters")
		}
		if utf8.RuneCountInString(*text) > MaxTextLength {
			return fmt.Errorf("text must contain at most %d characters", MaxTextLength)
		}
	default:
		return errors.New("operation kind is not supported")
	}

	return nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err == io.EOF {
		return nil
	} else if err != nil {
		return fmt.Errorf("decode trailing data: %w", err)
	}
	return errors.New("request must contain one JSON value")
}

func EqualJSON(left, right json.RawMessage) bool {
	return bytes.Equal(compactJSON(left), compactJSON(right))
}

func compactJSON(value json.RawMessage) []byte {
	var buffer bytes.Buffer
	if err := json.Compact(&buffer, value); err != nil {
		return value
	}
	return buffer.Bytes()
}
