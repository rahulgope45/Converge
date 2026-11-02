package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rahulgope45/converge/apps/server/internal/protocol"
)

var (
	ErrDocumentNotFound  = errors.New("document not found")
	ErrOperationConflict = errors.New("operation ID already contains different data")
)

type StoreOperationResult struct {
	ServerSequence int64 `json:"serverSequence"`
	Duplicate      bool  `json:"duplicate"`
}

func (s *Store) StoreOperation(
	ctx context.Context,
	operation protocol.Operation,
) (StoreOperationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return StoreOperationResult{}, fmt.Errorf("begin operation transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var documentExists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1)`,
		operation.DocumentID,
	).Scan(&documentExists); err != nil {
		return StoreOperationResult{}, fmt.Errorf("check document: %w", err)
	}
	if !documentExists {
		return StoreOperationResult{}, ErrDocumentNotFound
	}

	var sequence int64
	err = tx.QueryRow(ctx, `
		INSERT INTO operations (
			operation_id,
			document_id,
			actor_id,
			logical_time,
			kind,
			value
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (operation_id) DO NOTHING
		RETURNING server_sequence
	`,
		operation.OperationID,
		operation.DocumentID,
		operation.ActorID,
		operation.LogicalTime,
		operation.Kind,
		operation.Value,
	).Scan(&sequence)

	duplicate := false
	if errors.Is(err, pgx.ErrNoRows) {
		duplicate = true
		if err := verifyDuplicate(ctx, tx, operation, &sequence); err != nil {
			return StoreOperationResult{}, err
		}
	} else if err != nil {
		return StoreOperationResult{}, fmt.Errorf("insert operation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return StoreOperationResult{}, fmt.Errorf("commit operation: %w", err)
	}

	return StoreOperationResult{
		ServerSequence: sequence,
		Duplicate:      duplicate,
	}, nil
}

func verifyDuplicate(
	ctx context.Context,
	tx pgx.Tx,
	operation protocol.Operation,
	sequence *int64,
) error {
	var existing protocol.Operation
	var value []byte
	if err := tx.QueryRow(ctx, `
		SELECT
			server_sequence,
			operation_id::text,
			document_id::text,
			actor_id,
			logical_time,
			kind,
			value
		FROM operations
		WHERE operation_id = $1
	`, operation.OperationID).Scan(
		sequence,
		&existing.OperationID,
		&existing.DocumentID,
		&existing.ActorID,
		&existing.LogicalTime,
		&existing.Kind,
		&value,
	); err != nil {
		return fmt.Errorf("read duplicate operation: %w", err)
	}
	existing.Value = json.RawMessage(value)

	if existing.DocumentID != operation.DocumentID ||
		existing.ActorID != operation.ActorID ||
		existing.LogicalTime != operation.LogicalTime ||
		existing.Kind != operation.Kind ||
		!protocol.EqualJSON(existing.Value, operation.Value) {
		return ErrOperationConflict
	}

	return nil
}

func (s *Store) ListOperations(
	ctx context.Context,
	documentID string,
	after int64,
	limit int,
) ([]protocol.StoredOperation, error) {
	exists, err := s.DocumentExists(ctx, documentID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrDocumentNotFound
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			server_sequence,
			operation_id::text,
			document_id::text,
			actor_id,
			logical_time,
			kind,
			value
		FROM operations
		WHERE document_id = $1 AND server_sequence > $2
		ORDER BY server_sequence ASC
		LIMIT $3
	`, documentID, after, limit)
	if err != nil {
		return nil, fmt.Errorf("list operations: %w", err)
	}
	defer rows.Close()

	operations := make([]protocol.StoredOperation, 0)
	for rows.Next() {
		var stored protocol.StoredOperation
		var value []byte
		if err := rows.Scan(
			&stored.ServerSequence,
			&stored.Operation.OperationID,
			&stored.Operation.DocumentID,
			&stored.Operation.ActorID,
			&stored.Operation.LogicalTime,
			&stored.Operation.Kind,
			&value,
		); err != nil {
			return nil, fmt.Errorf("scan operation: %w", err)
		}
		stored.Operation.Value = json.RawMessage(value)
		operations = append(operations, stored)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate operations: %w", err)
	}

	return operations, nil
}
