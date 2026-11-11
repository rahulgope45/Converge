package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

func DecodeOperation(reader io.Reader) (Operation, error) {
	var operation Operation
	if err := decodeStrict(reader, &operation); err != nil {
		return Operation{}, fmt.Errorf("decode operation: %w", err)
	}
	if err := ValidateOperation(operation); err != nil {
		return Operation{}, err
	}
	return operation, nil
}

// DecodeBatch reads {"operations": [...]} and validates every operation.
// One invalid operation rejects the whole batch.
func DecodeBatch(reader io.Reader) ([]Operation, error) {
	var body batch
	if err := decodeStrict(reader, &body); err != nil {
		return nil, fmt.Errorf("decode batch: %w", err)
	}
	if len(body.Operations) == 0 || len(body.Operations) > MaxBatchSize {
		return nil, fmt.Errorf("operations must contain 1 to %d operations", MaxBatchSize)
	}
	for index, operation := range body.Operations {
		if err := ValidateOperation(operation); err != nil {
			return nil, fmt.Errorf("operations[%d]: %w", index, err)
		}
	}
	return body.Operations, nil
}

func ValidateOperation(operation Operation) error {
	if _, err := uuid.Parse(operation.OperationID); err != nil {
		return errors.New("operationId must be a UUID")
	}
	if _, err := uuid.Parse(operation.DocumentID); err != nil {
		return errors.New("documentId must be a UUID")
	}
	if !validActorID(operation.ActorID) {
		return fmt.Errorf("actorId must contain 1 to %d characters", MaxActorIDLength)
	}
	if operation.LogicalTime < 0 {
		return errors.New("logicalTime must be non-negative")
	}

	switch operation.Kind {
	case KindInsertText:
		return validateInsert(operation.Value)
	case KindDeleteText:
		return validateDelete(operation.Value)
	default:
		return errors.New("operation kind is not supported")
	}
}

// ValidateCharID checks a reference to a character.
func ValidateCharID(id CharID) error {
	if id.LogicalTime == nil || *id.LogicalTime < 0 {
		return errors.New("logicalTime must be a non-negative integer")
	}
	if !validActorID(id.ActorID) {
		return fmt.Errorf("actorId must contain 1 to %d characters", MaxActorIDLength)
	}
	return nil
}

func validateInsert(raw json.RawMessage) error {
	var value insertValue
	if err := decodeStrict(bytes.NewReader(raw), &value); err != nil {
		return errors.New("insert_text value must be an object with after and text")
	}
	if value.Text == nil {
		return errors.New("text must be a string")
	}
	if strings.ContainsRune(*value.Text, 0) {
		return errors.New("text must not contain NUL characters")
	}
	if length := utf8.RuneCountInString(*value.Text); length == 0 || length > MaxTextLength {
		return fmt.Errorf("text must contain 1 to %d characters", MaxTextLength)
	}
	if value.After != nil {
		if err := ValidateCharID(*value.After); err != nil {
			return fmt.Errorf("after: %w", err)
		}
	}
	return nil
}

func validateDelete(raw json.RawMessage) error {
	var value deleteValue
	if err := decodeStrict(bytes.NewReader(raw), &value); err != nil {
		return errors.New("delete_text value must be an object with spans")
	}
	if len(value.Spans) == 0 || len(value.Spans) > MaxDeleteSpans {
		return fmt.Errorf("spans must contain 1 to %d spans", MaxDeleteSpans)
	}
	for index, span := range value.Spans {
		if !validActorID(span.ActorID) {
			return fmt.Errorf("spans[%d]: actorId must contain 1 to %d characters", index, MaxActorIDLength)
		}
		if span.From == nil || *span.From < 0 {
			return fmt.Errorf("spans[%d]: from must be a non-negative integer", index)
		}
		if span.Length < 1 || span.Length > MaxTextLength {
			return fmt.Errorf("spans[%d]: length must be 1 to %d", index, MaxTextLength)
		}
	}
	return nil
}

func validActorID(actorID string) bool {
	return strings.TrimSpace(actorID) != "" && len(actorID) <= MaxActorIDLength
}

// decodeStrict decodes exactly one JSON value and rejects unknown fields.
func decodeStrict(reader io.Reader, target any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}

	var extra json.RawMessage
	if err := decoder.Decode(&extra); err == io.EOF {
		return nil
	} else if err != nil {
		return fmt.Errorf("decode trailing data: %w", err)
	}
	return errors.New("request must contain one JSON value")
}

// EqualJSON reports whether two JSON documents hold the same value,
// whatever their key order, spacing or string escaping.
func EqualJSON(left, right json.RawMessage) bool {
	var leftValue, rightValue any
	if err := json.Unmarshal(left, &leftValue); err != nil {
		return false
	}
	if err := json.Unmarshal(right, &rightValue); err != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}
