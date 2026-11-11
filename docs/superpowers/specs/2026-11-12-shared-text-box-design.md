# Shared text box: design

Date: 2026-11-12
Status: awaiting review

## Purpose

Converge stops being an incident tracker. Each room holds one shared text box.
Anyone in the room can type in it, and every replica ends up with the same text.
The local-first behaviour is unchanged: edits apply immediately, survive offline
use and refresh, and synchronize after reconnecting.

The text synchronizes the same way the incident title does today: as one
last-writer-wins value.

## Non-goals

- Character-level merging. Concurrent edits do not interleave; see Known limitation.
- Cursors, presence, or rich text.
- Migrating the contents of existing incident rooms.
- Rewriting the long-form files in `docs/` (01 to 06, consistency contract).
- New test coverage beyond keeping the existing convergence test meaningful.
  Manual two-window testing happens later.

## Known limitation

The whole text is one register. If two replicas change it concurrently, or one
edits offline and reconnects, the operation with the higher version
(logical time, then actor ID) wins on every replica and the other text is
discarded in full. This is the title's current behaviour and is accepted.

## Sync core (`packages/sync-core`)

- `Document = { id: string; text: string }` replaces `Incident`.
- `DocumentReplica` replaces `IncidentReplica`: `documentId`,
  `text: Register<string>`, `localClock`, `lastServerSequence`,
  `appliedOperationIds`.
- One operation: `SetTextOperation` with `kind: "set_text"` and
  `value: string`. `Operation` is that single type.
- `LocalChange = { kind: "set_text"; value: string }`.
- `applyOperation` keeps its rules: reject a foreign `documentId`, skip an
  already applied `operationId`, advance `localClock`, and update the register
  only when the incoming version is greater. An operation whose kind is not
  `set_text` (old rooms) is recorded as applied and advances the clock but
  changes no state.
- `createReplica(document)` and `projectDocument(replica)` replace the
  incident equivalents.
- `IncidentStatus`, `IncidentSeverity`, and the status and severity operations
  are deleted.
- `apply-operation.test.ts` is rewritten for `set_text`: immutability, and
  convergence under reordering, duplicates, and a concurrent tie broken by
  actor ID.

## Web app (`apps/web`)

### Editor

`components/TextEditor.tsx` replaces `IncidentEditor.tsx`. It renders one
labelled `<textarea>` with `maxLength` 10,000.

- It keeps a local draft, as the title input does.
- A change is committed 300 ms after the last keystroke and immediately on
  blur. A pending timer is cleared on blur and on unmount.
- A commit is skipped when the draft equals the current document text.
- Empty text is valid. Text is not trimmed.
- Enter inserts a newline.
- When the document text changes from outside (a remote operation, or a local
  commit echoing back), the draft is replaced with it, as the title does. If
  the user has typed since their last commit, that uncommitted draft is
  overwritten only when the incoming text differs from the last text this
  editor committed, so the editor's own echo never discards newer keystrokes.

### Controller

`IncidentSyncController` becomes `DocumentSyncController`; the snapshot field
`incident` becomes `document`. The initial document is `{ id, text: "" }`.
The empty-title guards in `change` and `flushPending` are removed. Catch-up,
flush, WebSocket handling, retry, and backoff are unchanged.

### Local storage

The IndexedDB database version goes from 1 to 2. The upgrade creates the
stores when they are missing and clears `replicas` and `pendingOperations`,
because stored values have the old shape. Unsent incident edits are dropped.

### Routing and copy

- Room URLs are `/rooms/<id>`. `/incidents/<id>` is no longer matched.
  The join form accepts a room ID or a `/rooms/<id>` link.
- Landing page, top bar, error strings, `index.html` description, and CSS
  class names drop the incident wording.

## Server (`apps/server`)

- `protocol`: the only kind is `set_text`. Its value must be a JSON string of
  at most 10,000 characters (counted as Unicode code points); empty is
  allowed. The three old kinds are rejected as unsupported.
- The request body limit in `httpapi` is raised if it is below what a
  10,000-character value needs (up to 40 KB of UTF-8 plus JSON escaping).
- `migrations/002_set_text.sql` replaces the `operations.kind` check
  constraint with one that allows `set_text` alongside the three old kinds,
  so existing rows remain valid. It is idempotent.
- Endpoints, WebSocket stream, idempotent commit, and catch-up are unchanged.
  Old rooms still return their old operations; clients ignore them.

## README

The introduction and any incident-specific wording are updated to describe a
shared text box. The architecture diagram is unchanged.

## Verification

- `npm run typecheck` and `npm test` pass.
- `go build ./...`, `go vet ./...`, and `go test ./...` pass.
- Migration 002 applies to the local database.
- One smoke check against the running servers: create a room, submit a
  `set_text` operation, and read it back through catch-up.
- Browser testing across two windows, including offline, is deferred.
