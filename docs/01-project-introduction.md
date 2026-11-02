# Converge: Project Introduction

## 1. Executive summary

Converge is a local-first, real-time incident-response workspace. Several engineers can update the same incident from different browsers, continue working while disconnected, and synchronize their changes after reconnecting. Replicas that receive the same operations must eventually reach the same state.

The portfolio claim is not merely "real-time collaboration." The important claim is:

> Converge preserves independent edits, tolerates duplicate and out-of-order delivery, works offline, and recovers from reconnects without losing an acknowledged operation.

The first usable version deliberately supports a small document:

- Incident title
- Severity: `SEV1`, `SEV2`, or `SEV3`
- Status: `investigating`, `identified`, `monitoring`, or `resolved`
- Two or more browser replicas editing the same incident
- Offline changes stored in the browser
- Reconnection and catch-up
- A durable server-side operation log

An ordered timeline, authentication, teams, comments, rich text, AI summaries, and multi-region scaling are future work. They are not required to prove the core synchronization design.

## 2. The real-world problem

Incident responders need a shared place to record status, severity, decisions, ownership, and an event timeline. A conventional cloud-only application has two weaknesses during an outage:

1. The user cannot make progress when the server or network is temporarily unavailable.
2. Concurrent edits are often handled by replacing a complete document, so one user's update can erase another user's update.

Converge addresses this by storing a local replica in each browser and synchronizing small immutable operations rather than sending a complete document after every edit.

Example:

```text
Starting document
title    = "Database issue"
status   = "investigating"
severity = "SEV2"

Rahul, while offline: set_status("resolved")
Priya, while online:  set_severity("SEV1")

Converged document
title    = "Database issue"
status   = "resolved"
severity = "SEV1"
```

Both independent changes survive.

## 3. Project goals

### Product goals

- Provide a simple incident board that is understandable in a 90-second demo.
- Apply local edits immediately without waiting for the network.
- Persist pending edits across browser refreshes.
- Synchronize edits in real time when connected.
- Recover automatically after a dropped connection.
- Display connection state: online, offline, synchronizing, or error.

### Engineering goals

- Model changes as immutable operations.
- Make operation submission idempotent with a unique `operationId`.
- Resolve concurrent field changes deterministically.
- Persist an operation before the server acknowledges it.
- Keep the Go server stateless except for live connection membership.
- Use PostgreSQL as the durable source of truth.
- Keep the MVP deployable as one frontend, one Go server, and one database.

### Portfolio goals

The finished project should provide evidence for discussing:

- Local-first architecture
- Event logs and state projection
- Lamport logical clocks
- Last-writer-wins registers
- Idempotency and deduplication
- WebSocket connection management
- Offline queues and reconnect logic
- PostgreSQL constraints and transactions
- Backpressure and slow clients
- Horizontal-scaling limitations
- Failure recovery and consistency trade-offs

## 4. Non-goals for the MVP

The following features are intentionally excluded from the first deployed version:

- Rich-text collaborative editing
- A fully decentralized peer-to-peer system
- End-to-end encryption
- Authentication and organizations
- User presence and cursors
- File attachments
- Chat
- AI-generated summaries
- Kubernetes
- Multiple independently deployed microservices
- Kafka or Redis
- Multiple Go server instances
- A custom text-sequence CRDT

This is scope control, not a statement that those features are unimportant.

## 5. Core concepts

### Replica

A replica is one local copy of an incident's state. Each browser has a replica. Replicas may temporarily differ while clients are offline or messages are delayed.

### Operation

An operation is immutable data describing one change, such as setting the incident status. It is not the function that applies the change.

```json
{
  "operationId": "5f4043d0-5ed7-4d8d-b96d-2b132480e04d",
  "documentId": "incident-123",
  "actorId": "browser-a",
  "logicalTime": 17,
  "kind": "set_status",
  "value": "resolved"
}
```

### Projection

A projection is the current incident state produced by applying accepted operations. The operation log records history; the projection answers "what is true now?"

### Convergence

If replicas receive the same operation set and no new operations are created, they must eventually produce the same projection even if delivery order differed.

### Acknowledgement

A server acknowledgement is a durability promise. The Go server must commit the operation to PostgreSQL before responding successfully.

## 6. MVP consistency rules

1. Duplicate operation IDs have no additional effect.
2. An operation for another document is rejected.
3. A higher Lamport time wins for two operations affecting the same field.
4. If Lamport times are equal, lexicographically greater `actorId` wins as a deterministic tie-breaker.
5. Changes to different fields are preserved independently.
6. The client records a local operation before displaying it as accepted locally.
7. The server commits an operation before acknowledging it.
8. A reconnecting client requests every server operation after its last stored server sequence.

These rules provide eventual convergence. They do not provide real-time linearizability across offline clients.

## 7. Architecture

```text
React browser replica
  - Incident UI
  - TypeScript sync core
  - IndexedDB projection and pending operations
  - Native WebSocket client
             |
             | HTTP: durable operation submission and catch-up
             | WebSocket: low-latency notification and broadcast
             v
Go server
  - Validation
  - PostgreSQL transaction
  - Idempotent operation insertion
  - Per-document connection hub
  - Health endpoint
             |
             v
PostgreSQL
  - documents
  - operations (append-only)
  - unique operation ID
  - per-document server sequence index
```

### Why HTTP and WebSocket are both used

- HTTP `POST` gives simple request/response acknowledgement semantics for durable writes.
- HTTP `GET` gives deterministic catch-up after reconnect.
- WebSocket provides immediate notification to other connected replicas.
- If WebSocket delivery fails, correctness is preserved because reconnect catch-up reads PostgreSQL.

WebSocket is an optimization for latency. PostgreSQL and catch-up are the correctness path.

## 8. Tool and technology decisions

| Tool | Where used | Why it is used | Why alternatives are deferred |
| --- | --- | --- | --- |
| TypeScript | Synchronization core and frontend | Existing experience, discriminated unions for operations, shared browser language | Rust/WASM would increase learning and build complexity |
| React | Browser UI | Small component model and familiar ecosystem | No SSR is required for the application |
| Vite | Frontend development/build | Fast development server and simple static build | Next.js server features are unnecessary |
| Plain CSS | MVP styling | Zero additional setup and full control | Tailwind can be added only if UI work becomes slow |
| Browser IndexedDB | Local projection, cursor, pending operations | Survives refresh and supports offline structured data | `localStorage` is synchronous and too limited |
| `idb` package | Small IndexedDB wrapper | Avoids verbose raw IndexedDB callbacks without becoming an application framework | Dexie provides more features than the MVP needs |
| Native browser WebSocket | Live updates | Built into browsers; no client dependency | Socket.IO introduces a separate protocol and fallback behavior |
| Go | API and synchronization server | Strong concurrency model, simple deployment binary, useful new backend language | Rewriting the entire system in TypeScript would add less learning value |
| `net/http` | Go HTTP server | Standard library, mature, sufficient routing for a small API | A large web framework is unnecessary |
| `github.com/coder/websocket` | Go WebSocket upgrade and connection API | Small, context-aware WebSocket library | Go's standard library does not provide a WebSocket server |
| `github.com/jackc/pgx/v5` | PostgreSQL driver and pool | Native PostgreSQL support, pooling, context cancellation, good Go API | An ORM hides the SQL and transaction behavior this project should demonstrate |
| `github.com/google/uuid` | Go UUID parsing and validation | Validates document and operation IDs at the HTTP boundary | Hand-written UUID parsing is unnecessary risk |
| PostgreSQL | Durable source of truth | Transactions, unique constraints, ordered operation history, familiar deployment options | Redis alone is not a durable operation ledger |
| SQL migration files | Database schema | Transparent and easy to review | A migration framework is unnecessary for the first schema |
| Docker Compose | Local PostgreSQL | Repeatable local database with one command | Installing PostgreSQL directly makes setup environment-dependent |
| Vitest | Minimal TypeScript correctness checks | Fast TypeScript test execution | Only two critical sync tests are mandatory in fast-track mode |
| Go `testing` | Minimal server checks | Built into Go | No external test framework required |
| Git and GitHub | History, collaboration, deployment source | Checkpoints and automatic deploy integration | Required for a portfolio repository |
| curl | Health/API verification | Available almost everywhere and scriptable | GUI API clients are optional |

## 9. When each part is introduced

1. **Sync core:** define operations, versions, merge comparison, and replica state.
2. **PostgreSQL:** create durable document and operation tables.
3. **Go HTTP API:** create documents, submit operations, and fetch catch-up history.
4. **WebSocket hub:** broadcast committed operations to connected clients.
5. **React UI:** edit title, status, and severity.
6. **IndexedDB:** persist the replica, cursor, and pending queue.
7. **Reconnect loop:** catch up, resend pending operations, and resume live updates.
8. **Deployment:** publish a two-browser demo.

## 10. Demonstration scenario

The final demo should show:

1. Open the same incident in two browser windows.
2. Disconnect browser A using DevTools offline mode.
3. Change status in A and severity in B.
4. Refresh A while still offline and show that its change remains.
5. Reconnect A.
6. Show both replicas converging to the same title, status, and severity.
7. Restart the Go server.
8. Reconnect and show that acknowledged operations remain available.

## 11. Current repository status

Implemented:

- Versioned incident registers and operation types
- Deterministic Lamport-time and actor-ID conflict resolution
- Duplicate operation protection and projection
- React/Vite incident editor with IndexedDB offline storage
- Room creation, share-link copying, and join-by-link or join-by-ID flows
- Service-worker application shell caching for offline deep-link reloads
- Pending-operation submission, catch-up, and reconnect controller
- Go HTTP API, PostgreSQL store, and WebSocket broadcast hub
- Docker Compose database definition and production server Dockerfile
- TypeScript convergence test and full static build verification
- End-to-end offline edit, refresh, reconnect, and two-browser convergence verification

Not implemented yet:

- Authentication and multi-tenancy
- Ordered incident timeline
- Cross-instance WebSocket fan-out
- Public cloud deployment

Always check the repository rather than assuming a planned component already exists.

