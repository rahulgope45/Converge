CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operations (
    server_sequence BIGSERIAL PRIMARY KEY,
    operation_id UUID NOT NULL UNIQUE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    logical_time BIGINT NOT NULL CHECK (logical_time >= 0),
    kind TEXT NOT NULL CHECK (
        kind IN ('set_title', 'set_status', 'set_severity')
    ),
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operations_document_sequence_idx
    ON operations (document_id, server_sequence);
