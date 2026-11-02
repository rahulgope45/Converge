package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

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
	case KindSetTitle:
		var title string
		if err := json.Unmarshal(operation.Value, &title); err != nil {
			return errors.New("set_title value must be a string")
		}
		title = strings.TrimSpace(title)
		if title == "" || len(title) > 200 {
			return errors.New("title must contain 1 to 200 characters")
		}
	case KindSetStatus:
		var status string
		if err := json.Unmarshal(operation.Value, &status); err != nil {
			return errors.New("set_status value must be a string")
		}
		if status != "investigating" && status != "identified" && status != "monitoring" && status != "resolved" {
			return errors.New("status is not supported")
		}
	case KindSetSeverity:
		var severity string
		if err := json.Unmarshal(operation.Value, &severity); err != nil {
			return errors.New("set_severity value must be a string")
		}
		if severity != "SEV1" && severity != "SEV2" && severity != "SEV3" {
			return errors.New("severity is not supported")
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
