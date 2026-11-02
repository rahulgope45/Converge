package store

import (
	"context"
	"fmt"
)

func (s *Store) CreateDocument(ctx context.Context) (string, error) {
	var documentID string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO documents DEFAULT VALUES
		RETURNING id::text
	`).Scan(&documentID); err != nil {
		return "", fmt.Errorf("create document: %w", err)
	}

	return documentID, nil
}

func (s *Store) DocumentExists(ctx context.Context, documentID string) (bool, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM documents WHERE id = $1)`,
		documentID,
	).Scan(&exists); err != nil {
		return false, fmt.Errorf("check document: %w", err)
	}
	return exists, nil
}
