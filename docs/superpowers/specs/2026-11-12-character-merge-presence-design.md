# Character-level merge, convergence proof, and presence: design

Date: 2026-11-12
Status: awaiting review
Builds on: `2026-11-12-shared-text-box-design.md`

## Purpose

Make Converge a real collaborative editor and a credible portfolio piece:

1. Concurrent and offline edits to the shared text merge character by
   character instead of one edit replacing the other.
2. Automated property-based tests demonstrate that replicas converge.
3. People in a room see who else is there and where their cursors are.

## Non-goals

- Garbage collection of deleted characters, log compaction, or snapshots.
- Multiple server instances.
- Accounts, editable display names, rich text, undo across replicas.
- Showing remote selections (only the caret is shown).
- Migrating rooms created with `set_text`; they open empty.

## 1. Merge model (`packages/sync-core`)

The text is a replicated growable array (RGA).

### Data

```ts
type CharId = { logicalTime: number; actorId: string };
type Element = { id: CharId; value: string; deleted: boolean };

type DocumentReplica = {
  documentId: string;
  elements: readonly Element[];      // document order, tombstones included
  localClock: number;
  lastServerSequence: number;
  orphans: readonly Operation[];     // received but not yet applicable
};
```

- One element holds one Unicode code point, so a surrogate pair is never split.
- `CharId`s are ordered by `logicalTime`, then `actorId` (the existing
  `compareVersion`).
- `appliedOperationIds` is removed; duplicates are detected from state.
- The visible text is the concatenation of non-deleted element values.

### Operations

```ts
type InsertTextOperation = Meta & {
  kind: "insert_text";
  value: { after: CharId | null; text: string };
};
type DeleteTextOperation = Meta & {
  kind: "delete_text";
  value: { spans: { actorId: string; from: number; length: number }[] };
};
```

`Meta` is the existing `operationId`, `documentId`, `actorId`, `logicalTime`.

- **Insert.** The i-th code point of `text` gets the id
  `(logicalTime + i, actorId)`. The first is placed after `after` (`null`
  means the start of the document); each following code point is placed
  directly after the previous one.
- **Placement rule.** Starting just after the `after` element, skip every
  element whose id is greater than the new first id, then insert the run
  there. This is the standard RGA rule and makes concurrent inserts at the
  same position resolve identically everywhere, without interleaving the two
  runs.
- **Delete.** A span names the ids `(from … from + length - 1, actorId)`.
  Each named element is marked deleted. Deleting twice is a no-op.
- **Clock.** A local insert of n code points takes `logicalTime =
  localClock + 1` and leaves `localClock` advanced by n. A local delete
  advances it by 1. Applying any operation raises `localClock` to at least
  the highest logical time it contains.

### Applying

`applyOperation(replica, operation)` stays pure and returns a new replica.

- An operation for another document throws.
- An insert whose first id is already present is a duplicate: no change.
- An insert whose `after` is not present, or a delete naming an id that is
  not present, cannot be applied yet. It is stored in `orphans` (once per
  `operationId`).
- After any successful apply, orphans are retried until none becomes
  applicable.
- An operation of any other kind (rooms from earlier versions) only raises
  the clock.

Result: any set of operations produces the same visible text whatever the
delivery order and however often each is delivered.

### Local edits

```ts
createLocalOperations(
  replica, actorId, newOperationId: () => string,
  edit: { text: string; caret?: number },   // caret in code points
): Operation[]
```

Compares `edit.text` with the replica's visible text and returns zero, one
or two operations (a delete, then an insert) that turn one into the other.
The changed range is found from the common prefix and suffix. When `caret`
is given, the text after the caret is taken as the unchanged suffix, so
typing "a" inside "aaa" inserts at the caret rather than at the first place
that happens to match.

### Anchors

```ts
anchorAt(replica, index): CharId | null          // id of the visible character before index
indexOfAnchor(replica, anchor): number | undefined
```

An anchor pins a caret to a character. `indexOfAnchor` returns the index
just after that character; if the character is deleted, just after the
nearest visible character before it; `undefined` if the id is unknown.
`null` is the start of the document. Indices are in code points.

## 2. Convergence proof

`fast-check` is added as a root dev dependency. Properties in `sync-core`:

1. **Convergence.** Three replicas start empty. A random script interleaves
   local edits (random insert or delete at a random position on a random
   replica) with random deliveries of already-created operations to random
   replicas, including repeats. After every operation is delivered to every
   replica, all visible texts are equal.
2. **Order independence.** For a random set of operations produced as above,
   applying them to an empty replica in any random permutation, with
   duplicates, gives the same visible text.
3. **Intention.** For a single replica, after `createLocalOperations` for any
   target text and applying the result, the visible text equals the target.
4. **Run integrity.** Two replicas concurrently insert runs at the same
   position; after exchange, each run appears contiguously in the result.

Plain unit tests cover the caret disambiguation, anchors across deletes,
orphan buffering, duplicate inserts, legacy kinds, and emoji handling.

## 3. Server (`apps/server`)

The server still stores and relays operations without interpreting the text.

### Validation

- Kinds accepted: `insert_text`, `delete_text`. `set_text` and the incident
  kinds are rejected.
- `insert_text`: `text` is a string of 1 to 10,000 code points with no NUL;
  `after` is `null` or `{ logicalTime ≥ 0, actorId of 1 to 100 characters }`.
- `delete_text`: 1 to 1,000 spans; each has an `actorId` of 1 to 100
  characters, `from ≥ 0` and `length` from 1 to 10,000.
- Unknown fields inside `value` are rejected.

### Batch submission

`POST /api/v1/documents/{documentId}/operations/batch`

- Body: `{ "operations": [ … ] }` with 1 to 100 operations, at most 1 MB.
- Every operation is validated before any is stored; any invalid one gives
  400 and stores nothing.
- Operations are then stored in order with the existing idempotent commit,
  and each newly stored one is broadcast.
- Response 200: `{ "results": [{ operationId, serverSequence, duplicate }] }`.
- A storage failure part-way returns the error status. The client retries
  the whole batch; already stored operations come back as duplicates.

The single-operation endpoint, catch-up, and stream URL are unchanged.

### Migration

`003_text_operations.sql` replaces the `operations.kind` check with one that
also allows `insert_text` and `delete_text`. Idempotent; old rows stay valid.

### Presence relay

The WebSocket becomes two-way for presence only. Presence is never stored.

- Client to server, at most 1,024 bytes:
  `{ "type": "presence", "actorId", "name", "color", "anchor" }` where
  `name` is 1 to 40 characters, `color` matches `#rrggbb`, and `anchor` is a
  `CharId`, `null` (start of text), or absent (no caret).
- The hub remembers each connection's latest valid presence and relays it to
  the other connections in the room.
- A new connection is sent the remembered presence of everyone already there.
- When a connection with a remembered presence closes, the others receive
  `{ "type": "presence_leave", "actorId" }`.
- Malformed frames are ignored.
- Stored operations keep their current frame shape (no `type` field); the
  client tells the two apart by the presence of `type`.

There is no authentication, so a client could claim another's `actorId`.
This is accepted, as it is for operations today.

## 4. Web app (`apps/web`)

### Editing

- The textarea is controlled directly by the replica's visible text. The
  300 ms debounce and `nextDraft` are removed. `sanitizeText` stays and is
  applied to typed text before it is diffed.
- On every input event the controller synchronously creates the local
  operations, applies them, and notifies listeners, so the textarea never
  lags behind typing. Persistence and network I/O follow asynchronously.
- The operations and the updated replica are written to IndexedDB in one
  transaction started in the same tick as the edit, so no later write can
  persist the replica without its pending operations.
- The caret and selection are stored as anchors. When a remote operation
  changes the text, the editor restores the selection from the anchors, so
  the caret stays on the same character.
- The DOM reports positions in UTF-16 units; a small tested module converts
  between those and code-point indices.
- `maxLength` remains 10,000.

### Sending

- Pending operations are sent through the batch endpoint, up to 100 per
  request, in logical-time order. Operations created while a request is in
  flight go in the next one.
- The pending count shown in the UI is kept in memory and initialised from
  IndexedDB at start.

### Local storage

IndexedDB version 3; the upgrade clears `replicas` and `pendingOperations`.

### Presence

- Each tab has a colour chosen from a fixed palette by hashing its actor id,
  and the name `Guest ` plus the first four characters of the actor id.
- The controller sends its presence when the socket opens and when the
  selection changes, at most once every 100 ms.
- Peers are dropped on `presence_leave` and all peers are cleared when the
  socket closes.
- The room shows a row of coloured chips: "You" and one per peer.
- Remote carets are drawn by a non-interactive overlay that mirrors the
  textarea's text, font, padding, wrapping and scroll position, with a thin
  coloured marker and name label at each peer's resolved index. A peer whose
  anchor is unknown locally has no marker until the character arrives.

## 5. Documentation

- README: describe character-level merging, the convergence tests, and
  presence; add a short "Design decisions and trade-offs" section covering
  why RGA, tombstones without collection, the single server instance, and
  unauthenticated presence.
- `docs/07-deploy-vercel-render.md`: run migration 003 as well.

## Known limitations

- Tombstones and the operation log grow without bound.
- Each edit copies the element array; acceptable at the 10,000-character cap.
- Concurrent edits can push the merged text past 10,000 characters.
- The remote-caret overlay depends on pixel-exact mirroring of the textarea
  and can only be confirmed in a real browser.

## Verification

- `npm run typecheck`, `npm test` (unit and property tests), `npm run build:web`.
- `gofmt`, `go vet`, `go test ./...`, including a hub test that connects two
  WebSocket clients and checks presence relay, replay to a late joiner, and
  the leave message.
- Migration 003 applied to the local database.
- Smoke check on the running servers: a batch of inserts and a delete is
  stored and read back; an invalid batch stores nothing.
- Two-window browser testing (merge, offline, carets) is done by the user.
