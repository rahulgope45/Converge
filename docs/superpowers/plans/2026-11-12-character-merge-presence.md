# Character Merge, Convergence Proof and Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-text last-writer-wins with a hand-written RGA sequence CRDT, prove convergence with property-based tests, and show live presence and remote carets.

**Architecture:** The sync core owns the CRDT (elements, insert/delete operations, orphan buffering, anchors) as pure functions. The Go server keeps storing and relaying opaque operations, gains a batch endpoint, and relays unstored presence frames over the existing WebSocket. The web controller applies edits synchronously and renders the textarea straight from the replica.

**Tech Stack:** TypeScript 7, Vitest 5, fast-check, React 19, `idb`; Go 1.27, `coder/websocket`, PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-11-12-character-merge-presence-design.md`

## Global Constraints

- Operation kinds are exactly `insert_text` and `delete_text`.
- One element is one Unicode code point. Core indices are code points; DOM offsets are UTF-16 and converted in `apps/web`.
- Insert text: 1 to 10,000 code points, no NUL. Delete: 1 to 1,000 spans, `length` 1 to 10,000.
- Batch: 1 to 100 operations, body at most 1 MB, validated all-or-nothing.
- Presence frame at most 1,024 bytes; `name` 1 to 40 characters; `color` matches `^#[0-9a-fA-F]{6}$`; client sends at most once per 100 ms.
- IndexedDB version 3. Textarea `maxLength` 10,000.
- Only new dependency: `fast-check` (root dev dependency).
- `node`/`npm`: `export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`. Local database: container `converge-postgres`. Dev servers on 8080 and 5174; the Go server must be restarted to pick up changes.
- Commit once per task on branch `shared-text-box`. Do not push.

## Review Focus

1. Concurrent inserts at the same position on three or more replicas with equal logical times: all replicas must agree and runs must not interleave. Task 1 properties.
2. An operation delivered before its dependency (WebSocket frame ahead of catch-up, or a delete before its insert): buffered, then applied; never dropped, never thrown. Task 1.
3. Text containing emoji or other astral characters: carets, diffs and anchors must not split a pair or drift by one. Tasks 1 and 3 (offset module tests).
4. A crash or reload between a local edit and its network send: the edit must still be pending and sent after reload, exactly once. Task 3 (single IndexedDB transaction; idempotent batch).
5. A peer disconnects uncleanly or a malformed presence frame arrives: other clients drop the peer; the hub neither panics nor closes healthy connections. Task 2 hub test.

---

### Task 1: RGA sync core with property tests

**Files:** rewrite `packages/sync-core/src/{model,replica,apply-operation,create-operation,index}.ts`; create `anchors.ts`, `diff.ts`; tests `apply-operation.test.ts` (rewrite), `create-operation.test.ts`, `anchors.test.ts`, `convergence.property.test.ts`. Add `fast-check` to root `devDependencies`.

**Produces (exported from `@converge/sync-core`):**
- Types `CharId`, `Element`, `Document`, `DocumentReplica`, `InsertTextOperation`, `DeleteTextOperation`, `Operation`, `TextEdit = { text: string; caret?: number }` exactly as in spec section 1.
- `createReplica(document: Document): DocumentReplica` (must be called with empty text; throws otherwise), `projectDocument(replica): Document`, `textOf(replica): string`.
- `applyOperation(replica, operation): DocumentReplica`.
- `createLocalOperations(replica, actorId, newOperationId: () => string, edit: TextEdit): Operation[]`.
- `anchorAt(replica, index): CharId | null`, `indexOfAnchor(replica, anchor: CharId | null): number | undefined`.
- `compareVersion` unchanged.

- [ ] Write unit tests: insert at start/middle/end; run placement; duplicate insert is a no-op; delete and double delete; orphaned insert and orphaned delete apply once the dependency arrives; legacy kind only raises the clock; foreign document throws; clock advances by run length; emoji is one element; caret disambiguation ("aaa" + "a" at caret 2 inserts after the second element); replace selection yields delete then insert; no-op edit yields `[]`; anchors survive remote insert before them and deletion of the anchored character.
- [ ] Write the four properties from spec section 2 with fast-check (`numRuns: 300`).
- [ ] Run `npm test`: fails.
- [ ] Implement. Run `npm test`: passes.
- [ ] Commit.

### Task 2: Server validation, batch endpoint, migration, presence relay

**Files:** modify `internal/protocol/{operation,validation}.go`, `validation_test.go`; modify `internal/httpapi/server.go`; modify `internal/realtime/hub.go`, create `internal/realtime/hub_test.go`; create `migrations/003_text_operations.sql`.

**Produces:**
- `protocol.KindInsertText`, `protocol.KindDeleteText`; `protocol.DecodeBatch(io.Reader) ([]Operation, error)` (body `{ "operations": [...] }`, 1 to 100, each validated).
- Route `POST /api/v1/documents/{documentId}/operations/batch` → 200 `{ "results": [{ operationId, serverSequence, duplicate }] }`; 400 if any operation is invalid or its `documentId` differs from the path.
- Hub: frames `{type:"presence",...}` relayed to other clients in the room, replayed to joiners, `{type:"presence_leave",actorId}` on close; malformed frames ignored.

- [ ] Extend the validation table: valid insert (after null, after id, emoji), invalid insert (empty text, 10,001 points, NUL, bad after, unknown field), valid delete, invalid delete (no spans, zero length, 1,001 spans), `set_text` rejected; `DecodeBatch` cases (empty list, 101 operations, one invalid among valid).
- [ ] Write `hub_test.go` with `httptest.NewServer` and two `websocket.Dial` clients: relay, replay to late joiner, leave on close, malformed frame ignored and connection stays usable.
- [ ] Run `go test ./...`: fails. Implement. `gofmt -l .`, `go vet ./...`, `go test ./...`: clean.
- [ ] Write and apply migration 003 twice.
- [ ] Commit.

### Task 3: Web app on the new core

**Files:** create `src/text-offsets.ts` (+ test), `src/sync/presence.ts` (+ test), `src/components/CaretOverlay.tsx`, `src/components/PresenceBar.tsx`; rewrite `src/components/TextEditor.tsx`, `src/sync/controller.ts`; modify `src/sync/api-client.ts`, `src/storage/replica-store.ts`, `src/App.tsx`, `src/styles.css`; reduce `src/components/draft.ts` to `sanitizeText` (+ test).

**Produces:**
- `text-offsets.ts`: `toCodePointIndex(text, utf16Offset): number`, `toUtf16Offset(text, codePointIndex): number` (an offset inside a pair rounds down to the pair's start).
- `presence.ts`: `identityFor(actorId): { name: string; color: string }`; types `PresenceFrame`, `Peer = { actorId; name; color; anchor: CharId | null | undefined }`; `parseServerFrame(data: string)` returning a stored operation, a presence, a leave, or `undefined`.
- `api-client.ts`: `submitOperations(documentId, operations: Operation[])`.
- `replica-store.ts`: `saveLocalOperations(replica, operations)`, `removePendingOperations(ids)`; version 3 upgrade clears both stores.
- Controller: `edit(text: string, caretUtf16: number): void` (synchronous apply and notify), `setSelection(startUtf16, endUtf16): void`; snapshot adds `selection?: { start: number; end: number }` and `peers: { actorId; name; color; offset?: number }[]` (UTF-16), `self: { name; color }`; `queuedLocalChanges` is removed.
- `TextEditor` props: `{ text, selection, peers, onEdit(text, caret), onSelect(start, end) }`.

- [ ] Write tests for `text-offsets`, `identityFor` (stable, palette member), `parseServerFrame`. Run: fail. Implement: pass.
- [ ] Rewrite controller, storage, API client, editor, overlay, presence bar, styles.
- [ ] `npm run typecheck`, `npm test`, `npm run build:web`: pass.
- [ ] Commit.

### Task 4: Documentation and end-to-end smoke check

- [ ] README: feature description and "Design decisions and trade-offs". Deployment guide: migration 003.
- [ ] Restart the Go server. With `curl`: create a room; batch-insert "héllo 😀" then delete one character; read back through catch-up; submit a batch with one invalid operation and confirm nothing new is stored; fetch `/rooms/<id>` from Vite.
- [ ] With a script over two WebSocket connections: presence from one reaches the other; closing one produces a leave.
- [ ] Commit. Report, including that two-window browser testing is the user's.
