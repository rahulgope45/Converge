# Converge: Complete Development Guide

## 1. Purpose of this guide

This is the implementation handoff for completing Converge without relying on prior chat history. It defines the fast-track build order, file ownership, operation behavior, persistence rules, server endpoints, frontend synchronization loop, and the minimum completion criteria.

The guide intentionally omits broad test coverage and optional product features. It retains two correctness checks because convergence and durable acknowledgement are the central claims of the project.

## 2. Final MVP repository structure

Create folders only when their phase begins.

```text
converge/
├── apps/
│   ├── web/
│   │   ├── public/
│   │   │   └── sw.js
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ConnectionBadge.tsx
│   │   │   │   └── IncidentEditor.tsx
│   │   │   ├── domain/
│   │   │   │   └── incident.ts
│   │   │   ├── storage/
│   │   │   │   └── replica-store.ts
│   │   │   ├── sync/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── connection.ts
│   │   │   │   └── sync-controller.ts
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── styles.css
│   │   ├── .env.example
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── server/
│       ├── cmd/server/main.go
│       ├── internal/
│       │   ├── config/config.go
│       │   ├── httpapi/
│       │   │   ├── handlers.go
│       │   │   ├── middleware.go
│       │   │   └── routes.go
│       │   ├── protocol/
│       │   │   ├── operation.go
│       │   │   └── validation.go
│       │   ├── realtime/
│       │   │   ├── client.go
│       │   │   └── hub.go
│       │   └── store/
│       │       ├── documents.go
│       │       ├── operations.go
│       │       └── postgres.go
│       ├── migrations/001_initial.sql
│       ├── .env.example
│       ├── Dockerfile
│       ├── go.mod
│       └── go.sum
├── packages/
│   └── sync-core/
│       ├── src/
│       │   ├── apply-operation.ts
│       │   ├── compare-version.ts
│       │   ├── model.ts
│       │   ├── replica.ts
│       │   └── index.ts
│       └── package.json
├── infra/docker-compose.yml
├── docs/
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

## 3. Fast-track scope

### Must ship

- One incident document with title, status, and severity
- Local edits that render immediately
- Browser persistence using IndexedDB
- Go API connected to PostgreSQL
- Idempotent operation insertion
- Catch-up endpoint using server sequence
- WebSocket broadcast after database commit
- Automatic reconnect with exponential backoff
- Two-browser convergence demo
- Connection status indicator
- Deployable frontend, backend, and database

### Explicitly skip

- Login and registration
- Organizations and permissions
- Rich text
- Ordered incident timeline
- Attachments
- Comments and chat
- Presence cursors
- AI features
- Redis
- Horizontal scaling
- Kubernetes
- Full design system
- Full unit and end-to-end test suites

## 4. Phase 1: finish the synchronization core

### 4.1 Replace plain values with versioned registers

A plain incident loses the information needed to resolve concurrent writes. The internal replica should store a version with each field.

```ts
export type Version = {
  logicalTime: number;
  actorId: string;
};

export type Register<T> = {
  value: T;
  version: Version;
};

export type IncidentReplica = {
  documentId: string;
  title: Register<string>;
  status: Register<IncidentStatus>;
  severity: Register<IncidentSeverity>;
  localClock: number;
  lastServerSequence: number;
  appliedOperationIds: string[];
};
```

The array is acceptable for the first persisted model. Convert it to a `Set` while operating in memory if convenient, then serialize it back to an array.

### 4.2 Keep the external projection simple

React should not need to understand version metadata.

```ts
export type Incident = {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
};
```

Create `projectIncident(replica): Incident` to expose register values to the UI.

### 4.3 Operation model

Keep the existing discriminated union and metadata. Generate operation IDs using `crypto.randomUUID()` in the browser.

```ts
type OperationMetadata = {
  operationId: string;
  documentId: string;
  actorId: string;
  logicalTime: number;
};
```

The MVP operations remain:

- `set_title`
- `set_status`
- `set_severity`

### 4.4 Version comparison

Create `compare-version.ts`.

Rules:

```text
incoming logicalTime > current logicalTime  => incoming wins
incoming logicalTime < current logicalTime  => current wins
logical times equal and incoming actorId > current actorId => incoming wins
otherwise current wins
```

Use a lexicographic string comparison for `actorId`. The actor tie-breaker has no business meaning; it only ensures every replica makes the same decision.

Pseudo-code:

```text
compareVersion(incoming, current):
  if incoming.logicalTime != current.logicalTime:
    return incoming.logicalTime - current.logicalTime
  return lexicalCompare(incoming.actorId, current.actorId)
```

### 4.5 Applying an operation to a replica

`applyOperation` must follow this order:

1. Reject a mismatched `documentId`.
2. If `operationId` is already applied, return the unchanged replica.
3. Set `localClock = max(localClock, operation.logicalTime)`.
4. Select the register using `operation.kind`.
5. Compare the incoming version with the register version.
6. If incoming wins, replace only that register.
7. Record the operation ID even if it lost the conflict. This prevents repeated work.
8. Return a new replica object; do not mutate the input.

### 4.6 Creating a local operation

When a user edits a field:

```text
nextClock = replica.localClock + 1
operation.logicalTime = nextClock
operation.actorId = stable browser actor ID
operation.operationId = crypto.randomUUID()
```

The browser actor ID is created once and stored in IndexedDB. Do not generate a new actor ID per operation.

### 4.7 Minimum safety check

Keep one convergence test:

1. Create replicas A and B from the same initial state.
2. A creates `set_status` at logical time 1.
3. B creates `set_severity` at logical time 1.
4. Apply operations in order A,B to replica A.
5. Apply operations in order B,A to replica B.
6. Assert projected incidents are equal.
7. Apply both operations again and assert the projection is unchanged.

Do not build a large test suite during fast-track development.

## 5. Phase 2: PostgreSQL schema

Create `infra/docker-compose.yml` with one PostgreSQL service for local development. Use a named volume so data survives container restart.

Create `apps/server/migrations/001_initial.sql`:

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE operations (
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

CREATE INDEX operations_document_sequence_idx
    ON operations (document_id, server_sequence);
```

Why both IDs exist:

- `operation_id` is created by a client and provides retry deduplication.
- `server_sequence` is assigned by PostgreSQL and provides efficient catch-up order.
- `logical_time` resolves concurrent field values; it is not a database cursor.

Do not use one number for all three jobs.

## 6. Phase 3: Go server foundation

### 6.1 Go module and dependencies

Inside `apps/server`:

```bash
go mod init github.com/rahulgope45/converge/apps/server
go get github.com/jackc/pgx/v5/pgxpool
go get github.com/coder/websocket
go get github.com/google/uuid
```

Use standard library `net/http` routing. Do not introduce a web framework for four endpoints.

### 6.2 Configuration

Read configuration from environment variables:

```text
PORT=8080
DATABASE_URL=postgres://converge:converge@localhost:5432/converge?sslmode=disable
ALLOWED_ORIGINS=http://localhost:5173
```

Fail startup if `DATABASE_URL` is empty. Use port `8080` locally and respect the platform-provided `PORT` in deployment.

### 6.3 Protocol structures

Mirror the TypeScript operation union in Go. Use one envelope with `json.RawMessage` for the value, then validate by kind.

```go
type Operation struct {
    OperationID string          `json:"operationId"`
    DocumentID  string          `json:"documentId"`
    ActorID     string          `json:"actorId"`
    LogicalTime int64           `json:"logicalTime"`
    Kind        string          `json:"kind"`
    Value       json.RawMessage `json:"value"`
}
```

Validation rules:

- All IDs must be present and valid UUIDs except `actorId`, which is a non-empty bounded string.
- `logicalTime` must be non-negative.
- Title must be non-empty after trimming and at most 200 characters.
- Status must be one of the four allowed values.
- Severity must be `SEV1`, `SEV2`, or `SEV3`.
- Request bodies have a size limit.
- Unknown JSON fields should be rejected for API requests.

### 6.4 Store operation logic

Use a PostgreSQL transaction:

1. Confirm the document exists.
2. Insert the operation using `ON CONFLICT (operation_id) DO NOTHING`.
3. If inserted, read its `server_sequence` from `RETURNING`.
4. If duplicate, query the existing row by `operation_id` and verify it belongs to the same document and has identical content. Reject an operation-ID collision with different content.
5. Commit.
6. Only after commit, publish the stored operation to the WebSocket hub.
7. Return an acknowledgement containing `operationId`, `serverSequence`, and `duplicate`.

Never broadcast before commit. A broadcast followed by a failed transaction would expose an operation that cannot be recovered during catch-up.

## 7. Phase 4: HTTP API

Use `/api/v1` as the prefix.

### `GET /health`

Response:

```json
{"status":"ok"}
```

Return 200 only when the process is ready. A separate database readiness check can be added later.

### `POST /api/v1/documents`

Create a UUID document row and return:

```json
{"documentId":"..."}
```

The frontend creates initial field operations immediately afterward. This keeps the same operation path for initial and later values.

### `POST /api/v1/documents/{documentId}/operations`

Accept one operation. Verify the path document ID equals the body document ID. Persist before responding.

New operation response:

```json
{
  "operationId": "...",
  "serverSequence": 42,
  "duplicate": false
}
```

Retry response uses the existing sequence and `duplicate: true`.

### `GET /api/v1/documents/{documentId}/operations?after=42`

Return operations where `server_sequence > after`, ordered ascending, with a bounded page size such as 500.

```json
{
  "operations": [
    {"serverSequence":43,"operation":{}}
  ],
  "lastServerSequence": 43,
  "hasMore": false
}
```

The client repeats requests while `hasMore` is true.

### `GET /api/v1/documents/{documentId}/stream`

Upgrade to WebSocket. Each message contains one committed operation and its server sequence.

WebSocket is not used as the only recovery channel. If a message is missed, HTTP catch-up repairs the gap.

## 8. Phase 5: WebSocket hub

Implement one in-memory hub for a single Go process.

### Hub responsibilities

- Register a client under a document ID.
- Unregister closed clients.
- Broadcast committed operations to clients for that document.
- Give each client a bounded outbound channel.
- Use one writer goroutine per socket; never write concurrently to one socket.
- If a client cannot consume its bounded queue, close it. The client reconnects and catches up from PostgreSQL.
- Use ping/pong or library keepalive support to discover dead clients.
- Cancel goroutines when the request context ends.

### Important limitation

The in-memory hub works only with one server instance. Two instances do not share connected clients. Before horizontal scaling, add PostgreSQL `LISTEN/NOTIFY`, Redis pub/sub, or another cross-instance broadcast layer.

## 9. Phase 6: React frontend

### 9.1 Scaffold

Create the Vite React TypeScript application under `apps/web`. Keep it a single-page application.

Required UI:

- Incident ID
- Editable title input
- Severity selector
- Status selector
- Connection badge
- Last synchronized sequence
- Small event/debug panel showing pending operation count

Do not build login, navigation, dashboards, or a component library.

### 9.2 Local replica store

Use IndexedDB through the `idb` package. Create stores:

```text
replicas
  key: documentId
  value: serialized IncidentReplica

pendingOperations
  key: operationId
  index: documentId
  value: Operation

settings
  key: actorId
```

Every local edit follows this order:

1. Read the current replica.
2. Increment the Lamport clock.
3. Create an operation with a UUID.
4. In one IndexedDB transaction, save the updated replica and pending operation.
5. Update React state.
6. If online, submit the operation.

Local persistence happens before the UI treats the edit as accepted.

### 9.3 Submission loop

For each pending operation:

1. `POST` it to the Go API.
2. On successful acknowledgement, remove it from `pendingOperations`.
3. Advance `lastServerSequence` if the response sequence is greater.
4. On network failure, keep it pending and retry later.
5. On validation failure, mark it rejected and show an error; do not retry forever.

Retries reuse the same `operationId`.

### 9.4 Receiving operations

When a WebSocket message arrives:

1. If `serverSequence <= lastServerSequence`, it may already be processed; safely apply/deduplicate anyway.
2. Apply the operation through `sync-core`.
3. Save the updated replica and cursor in IndexedDB.
4. Update React.

### 9.5 Reconnection sequence

Correct reconnect order:

1. Mark state as synchronizing.
2. Fetch operations after `lastServerSequence` until caught up.
3. Apply and persist them in sequence order.
4. Resubmit pending local operations using their original IDs.
5. Open or reopen the WebSocket stream.
6. Run one final catch-up request to close the race between the earlier catch-up and socket establishment.
7. Mark state online.

Use exponential backoff with jitter, for example approximately 1s, 2s, 4s, 8s, capped at 30s. Reset after a stable connection.

## 10. Phase 7: minimal validation

Do not skip these two checks:

### Check A: sync-core convergence

One automated Vitest case applying the same operation set in different orders and with duplicates.

### Check B: durable acknowledgement

One Go integration check or manual script:

1. Submit an operation.
2. Receive acknowledgement.
3. Restart the server.
4. Fetch operations after sequence zero.
5. Confirm the acknowledged operation exists.

Everything else may be manually verified during fast-track development.

## 11. Phase 8: demo polish

- Use a clean neutral layout.
- Make connection status visible.
- Add a button to copy the incident URL.
- Add a development-only network simulation control only if time remains.
- Write a README with architecture, demo steps, known limitations, and screenshots.
- Record a short video showing offline edits and convergence.

## 12. Completion checklist

The MVP is complete when:

- Two browsers can open one incident.
- Each can edit all three fields.
- Online changes appear in the other browser without refresh.
- An offline edit survives refresh.
- Offline and online independent edits both survive reconnection.
- Duplicate submission does not create a second operation.
- Restarting the server does not lose an acknowledged operation.
- The repository has documented startup and deployment commands.
- A public deployment is available.

## 13. Recommended implementation order from the current state

1. Format the existing sync-core files.
2. Add `Version`, `Register`, and `IncidentReplica`.
3. Implement version comparison and replica-aware `applyOperation`.
4. Keep one convergence test.
5. Add Docker Compose and the SQL migration.
6. Build Go `/health`, configuration, and database connection.
7. Build document creation, operation submission, and catch-up.
8. Build the WebSocket hub and stream endpoint.
9. Scaffold React/Vite.
10. Build the incident editor using in-memory state.
11. Add IndexedDB and pending operations.
12. Add reconnect and catch-up.
13. Perform the two-browser demo.
14. Deploy.

