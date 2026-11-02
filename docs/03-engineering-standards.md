# Converge: Engineering Standards

## 1. Purpose

These standards keep the fast-track implementation understandable and defensible in an interview. They are deliberately smaller than an enterprise handbook.

Priority order:

1. Correctness of synchronization and durability
2. Clear ownership and simple code
3. Security at external boundaries
4. Observable failures
5. Performance supported by measurements
6. Additional features

## 2. Scope discipline

- Build only the MVP described in `01-project-introduction.md`.
- Use one React application, one Go service, and one PostgreSQL database.
- Do not add a service, dependency, abstraction, or configuration option for a hypothetical future use.
- Prefer browser, Go standard-library, and PostgreSQL features before adding packages.
- Every added dependency must have a specific documented job.
- Do not implement auth, rich text, timeline ordering, Redis, Kafka, Kubernetes, or AI before the MVP completion checklist passes.

## 3. Architecture boundaries

### `packages/sync-core`

- Pure TypeScript domain and synchronization logic.
- No React imports.
- No HTTP, WebSocket, IndexedDB, or environment access.
- Functions accept values and return values.
- The same operation set must produce the same final projection.

### `apps/web`

- Owns rendering, user interaction, IndexedDB, HTTP, WebSocket, and reconnect behavior.
- Calls `sync-core`; it does not duplicate merge rules.
- Never treats the WebSocket as durable storage.
- Stores an operation locally before considering a local edit accepted.

### `apps/server`

- Owns validation, persistence, acknowledgement, catch-up, and live fan-out.
- Does not decide the final client field value; clients use deterministic sync-core rules.
- Commits before acknowledging or broadcasting.
- Does not store durable state only in memory.

### PostgreSQL

- Source of truth for acknowledged operations.
- Enforces unique operation IDs.
- Provides per-document ordered server sequences.
- Schema changes occur through reviewed SQL migration files.

## 4. TypeScript standards

- Enable strict TypeScript.
- Do not use `any`. Use `unknown`, validate, then narrow.
- Use discriminated unions for operation kinds.
- Prefer `type` for data shapes and unions.
- Export only types and functions needed by another module.
- Use immutable updates for replica state.
- Name boolean values as questions: `hasMore`, `isOnline`, `wasInserted`.
- Use `camelCase` for variables/functions, `PascalCase` for types/components, and kebab-case file names.
- Use semicolons and automated formatting once a formatter is added.
- Avoid type assertions such as `as Operation` on untrusted network data.
- Validate parsed JSON before passing it into sync-core.

## 5. Go standards

- Run `gofmt` on every Go file.
- Use the standard library unless a dependency has a clear advantage.
- Pass `context.Context` through database and network operations.
- Check every returned error.
- Wrap errors with useful context using `%w`.
- Keep `main.go` limited to wiring and process lifecycle.
- Put application-only packages under `internal/`.
- Define interfaces at the consumer only when a second implementation or isolated test requires one.
- Use one goroutine as the writer for each WebSocket.
- Do not hold a mutex while performing network or database I/O.
- Bound channels and request bodies.
- Apply server read, write, idle, and shutdown timeouts.
- Handle `SIGINT` and `SIGTERM` with graceful shutdown.
- Never log secrets or complete database URLs.

## 6. API standards

- Prefix endpoints with `/api/v1` except `/health`.
- Use JSON and `Content-Type: application/json`.
- Return structured errors:

```json
{
  "error": {
    "code": "invalid_operation",
    "message": "status is not supported"
  }
}
```

- Do not expose stack traces or raw database errors.
- Use appropriate status codes:
  - 200 for successful reads and duplicate acknowledgement
  - 201 for newly created document or operation
  - 400 for malformed requests
  - 404 for unknown documents
  - 409 for operation-ID collision with different content
  - 413 for oversized payloads
  - 500 for unexpected server errors
- Validate path and body document IDs match.
- Restrict CORS to configured frontend origins.
- Give each request a request ID and include it in logs and error responses.

## 7. Operation standards

- Operation IDs are UUIDs generated once and reused for every retry.
- Operations are immutable after creation.
- Actor ID is stable for one browser installation.
- Logical time is an integer and never decreases for one actor.
- Server sequence is assigned only by PostgreSQL.
- Duplicate operation IDs with identical content are accepted as retries.
- Duplicate operation IDs with different content are rejected as collisions.
- Unknown operation kinds are rejected.
- Merge rules must never depend on local wall-clock time or message arrival order.

## 8. Database standards

- Use parameterized SQL only.
- Use a connection pool with a bounded maximum.
- Set query timeouts through context.
- Keep transactions short.
- Commit before acknowledging.
- Add constraints for invariants that the database can enforce.
- Index catch-up queries by `(document_id, server_sequence)`.
- Never store durable data on a deployment instance's local filesystem.
- Do not edit a migration after it has been applied to a shared environment; create a new migration.

## 9. Frontend and offline standards

- Every edit is local-first: persist, project, render, then synchronize.
- Show connection state honestly; do not show "saved" when only memory contains the change.
- Preserve pending operations on refresh.
- Retry only network and retryable server failures.
- Do not retry permanent validation failures forever.
- Use accessible labels for every input.
- Make keyboard navigation possible.
- Never render untrusted text as HTML.
- Keep API and WebSocket URLs in environment variables.

## 10. Logging and observability

Use structured logs with fields rather than concatenated prose.

Recommended fields:

```text
timestamp
level
request_id
document_id
operation_id
actor_id
server_sequence
event
duration_ms
error
```

Never log:

- Database passwords
- Authorization tokens
- Entire environment-variable dumps
- User-provided content unless necessary for a bounded development diagnostic

Minimum events:

- Server started/stopped
- Database connected/failed
- Operation inserted/deduplicated/rejected
- WebSocket connected/disconnected/slow-client-closed
- Catch-up page served
- Client reconnect scheduled/completed

## 11. Minimal verification standard

Fast-track mode still requires:

1. One automated convergence/idempotency test in TypeScript.
2. One durable-acknowledgement check against PostgreSQL.
3. TypeScript type checking.
4. `go test ./...` even if most packages initially have no tests.
5. Manual two-browser offline/reconnect demonstration before deployment.

Do not claim properties that were not exercised.

## 12. Git standards

- Keep `main` runnable.
- Commit one coherent checkpoint at a time.
- Use concise conventional-style messages:

```text
feat: add versioned incident registers
feat: persist idempotent operations
fix: close reconnect catch-up gap
docs: add Render deployment steps
```

- Review `git status` and `git diff --staged` before committing.
- Never commit `.env`, credentials, `node_modules`, compiled binaries, or database volumes.
- Tag a stable demo as `v0.1.0`.

## 13. Documentation standard

- Keep current behavior separate from planned behavior.
- Update startup instructions when commands change.
- Record important trade-offs in short architecture decision records under `docs/adr/` only when needed.
- State limitations honestly.
- Include measured results with the exact command and environment used.
- Do not use words such as "scalable," "exactly once," or "production ready" without defining and proving them.

## 14. Definition of done for a change

A change is done when:

- The requested behavior works end to end.
- Trust-boundary input is validated.
- Errors contain enough context for diagnosis without leaking secrets.
- Relevant docs or environment examples are updated.
- Type checking and the minimal relevant check pass.
- No unrelated feature or abstraction was added.
- Known limitations are written down.

