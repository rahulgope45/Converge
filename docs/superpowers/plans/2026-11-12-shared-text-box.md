# Shared Text Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incident fields (title, status, severity) with one shared text box per room, synchronized as a single last-writer-wins value.

**Architecture:** The sync core keeps its register and version rules but holds one `text` register and one `set_text` operation. The Go server validates and stores only that operation; its endpoints and stream are untouched. The web app swaps the incident editor for a textarea that commits 300 ms after typing stops and on blur.

**Tech Stack:** TypeScript 7, Vitest 5, React 19, Vite, `idb`; Go 1.27, PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-11-12-shared-text-box-design.md`

## Global Constraints

- Operation kind string is exactly `set_text`; its value is a string.
- Maximum text length is 10,000, counted in Unicode code points on the server and by `maxLength` on the textarea. Empty text is valid. Text is never trimmed.
- Commit delay after the last keystroke is 300 ms; blur commits immediately.
- Room URLs are `/rooms/<id>`; `/incidents/<id>` is not matched.
- No user-facing string or identifier mentions "incident" after the last task. Files under `docs/` other than this plan and the spec are not edited.
- No new dependencies.
- `node` and `npm` are not on the default `PATH`: prefix commands with `export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`.
- The local database runs in the container `converge-postgres` (host port 5433, user, password and database all `converge`). The backend and frontend dev servers are already running on 8080 and 5174.
- Commit only if the user has asked for commits; otherwise leave changes in the working tree.

## Review Focus

1. A remote text arrives while the user is mid-word with uncommitted keystrokes: the box takes the remote text (accepted limitation), but the editor's own echo must never erase newer keystrokes. Owned by Task 3 (pure helper test).
2. A room created before this change is opened: its `set_title`, `set_status` and `set_severity` operations arrive through catch-up and must be skipped without throwing, leaving the text empty and the cursor advanced. Owned by Task 1.
3. Text containing multi-byte characters (emoji, non-Latin scripts) near the limit: 10,000 code points must be accepted even though it is more than 10,000 bytes. Owned by Task 2.
4. A browser that still holds a version-1 IndexedDB with incident-shaped replicas: the app must load an empty document rather than crash on the old shape. Owned by Task 3 (upgrade step; checked by typecheck and the deferred browser test).
5. The user clears the box completely: empty text must be sent and accepted, not silently dropped as empty titles were. Owned by Tasks 2 and 3.

---

### Task 1: Sync core holds one text register

**Files:**
- Modify: `packages/sync-core/src/model.ts`, `replica.ts`, `create-operation.ts`, `apply-operation.ts`, `index.ts`
- Test: `packages/sync-core/src/apply-operation.test.ts` (rewrite)

**Interfaces:**
- Produces, all exported from `@converge/sync-core`:
  - `type Document = { id: string; text: string }`
  - `type DocumentReplica = { documentId: string; text: Register<string>; localClock: number; lastServerSequence: number; appliedOperationIds: readonly string[] }`
  - `type SetTextOperation = { operationId: string; documentId: string; actorId: string; logicalTime: number; kind: "set_text"; value: string }`
  - `type Operation = SetTextOperation`
  - `type LocalChange = { kind: "set_text"; value: string }`
  - `createReplica(document: Document): DocumentReplica`
  - `projectDocument(replica: DocumentReplica): Document`
  - `createLocalOperation(replica: DocumentReplica, actorId: string, operationId: string, change: LocalChange): Operation`
  - `applyOperation(replica: DocumentReplica, operation: Operation): DocumentReplica`
  - `compareVersion`, `Register`, `Version` unchanged.
- Removed exports: `Incident`, `IncidentReplica`, `IncidentStatus`, `IncidentSeverity`, `SetTitleOperation`, `SetStatusOperation`, `SetSeverityOperation`, `projectIncident`.

- [ ] **Step 1: Rewrite the test file** with these cases, starting from `createReplica({ id: "doc-1", text: "" })`:

```ts
it("applies an operation without mutating the original replica", () => {
  const result = applyOperation(replica, op("op-1", "actor-a", 1, "hello"));
  expect(projectDocument(result).text).toBe("hello");
  expect(projectDocument(replica).text).toBe("");
  expect(result).not.toBe(replica);
});

it("converges despite reordering, duplicates, and a concurrent tie", () => {
  const early = op("op-early", "actor-a", 1, "first");
  const loser = op("op-a", "actor-a", 2, "from a");
  const winner = op("op-b", "actor-b", 2, "from b");
  const a = [early, loser, winner, early].reduce(applyOperation, replica);
  const b = [winner, early, loser, winner].reduce(applyOperation, replica);
  expect(projectDocument(a)).toEqual(projectDocument(b));
  expect(projectDocument(a)).toEqual({ id: "doc-1", text: "from b" });
});

it("accepts empty text as a value", () => {
  const filled = applyOperation(replica, op("op-1", "actor-a", 1, "x"));
  expect(projectDocument(applyOperation(filled, op("op-2", "actor-a", 2, ""))).text).toBe("");
});

it("skips operations of an unknown kind without throwing", () => {
  const legacy = { operationId: "op-old", documentId: "doc-1", actorId: "actor-a", logicalTime: 7, kind: "set_title", value: "Old" } as unknown as Operation;
  const result = applyOperation(replica, legacy);
  expect(projectDocument(result).text).toBe("");
  expect(result.localClock).toBe(7);
  expect(result.appliedOperationIds).toContain("op-old");
});

it("rejects an operation for another document", () => {
  expect(() => applyOperation(replica, { ...op("op-1", "actor-a", 1, "x"), documentId: "doc-2" })).toThrow();
});
```

`op(operationId, actorId, logicalTime, value)` is a local helper returning a `SetTextOperation` for `doc-1`.

- [ ] **Step 2: Run `npm test`.** Expected: fails to compile or fails on `projectDocument`.
- [ ] **Step 3: Change the five source files** to the interfaces above. In `applyOperation`, keep the existing order of checks; after building `nextReplica`, return it unchanged when `operation.kind !== "set_text"`.
- [ ] **Step 4: Run `npm test`.** Expected: 5 tests pass. (`npm run typecheck` still fails in `apps/web` until Task 3.)

### Task 2: Server accepts only `set_text`

**Files:**
- Modify: `apps/server/internal/protocol/operation.go`, `apps/server/internal/protocol/validation.go`
- Create: `apps/server/internal/protocol/validation_test.go`, `apps/server/migrations/002_set_text.sql`

**Interfaces:**
- Produces: `protocol.KindSetText = "set_text"`, `protocol.MaxTextLength = 10000`. `KindSetTitle`, `KindSetStatus`, `KindSetSeverity` are deleted. `ValidateOperation` signature is unchanged.

- [ ] **Step 1: Write `validation_test.go`** as a table test over `ValidateOperation`, using valid UUIDs, actor `"actor-a"`, logical time 1:

| name | kind | value (raw JSON) | want error |
|---|---|---|---|
| plain text | `set_text` | `"hello\nworld"` | no |
| empty text | `set_text` | `""` | no |
| 10,000 emoji | `set_text` | 10,000 × `😀` quoted | no |
| 10,001 characters | `set_text` | 10,001 × `a` quoted | yes |
| non-string | `set_text` | `42` | yes |
| legacy title | `set_title` | `"Old"` | yes |

- [ ] **Step 2: Run `go test ./...` in `apps/server`.** Expected: compile failure on `KindSetText`.
- [ ] **Step 3: Update `operation.go` and the `switch` in `validation.go`.** Count length with `utf8.RuneCountInString`; error messages: `set_text value must be a string`, `text must contain at most 10000 characters`. `maxRequestBody` (64 KB) stays as it is.
- [ ] **Step 4: Write `002_set_text.sql`:**

```sql
ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_kind_check;
ALTER TABLE operations ADD CONSTRAINT operations_kind_check
    CHECK (kind IN ('set_text', 'set_title', 'set_status', 'set_severity'));
```

First confirm the existing constraint's name with `docker exec converge-postgres psql -U converge -d converge -c '\d operations'`; if it is not `operations_kind_check`, drop that name too.

- [ ] **Step 5: Run `gofmt -l .`, `go vet ./...`, `go test ./...`.** Expected: no output from gofmt, vet clean, tests pass.
- [ ] **Step 6: Apply the migration twice** with `docker exec -i converge-postgres psql -U converge -d converge -v ON_ERROR_STOP=1 < apps/server/migrations/002_set_text.sql`. Expected: both runs succeed.

### Task 3: Web app shows and syncs one text box

**Files:**
- Create: `apps/web/src/components/TextEditor.tsx`, `apps/web/src/components/draft.ts`, `apps/web/src/components/draft.test.ts`
- Delete: `apps/web/src/components/IncidentEditor.tsx`
- Modify: `apps/web/src/sync/controller.ts`, `apps/web/src/sync/api-client.ts`, `apps/web/src/storage/replica-store.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/index.html`, `apps/web/public/sw.js`, `README.md`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `draft.ts`: `nextDraft(input: { draft: string; lastCommitted: string; incoming: string }): string`. Returns `draft` when `incoming === lastCommitted` (the editor's own echo, or no change); otherwise returns `incoming`.
  - `TextEditor` props: `{ document: Document; onChange: (change: LocalChange) => void }`.
  - `DocumentSyncController` (same public methods as `IncidentSyncController`); `SyncSnapshot.document?: Document` replaces `incident`.

- [ ] **Step 1: Write `draft.test.ts`:**

```ts
it("keeps newer keystrokes when the editor's own commit echoes back", () => {
  expect(nextDraft({ draft: "hello wor", lastCommitted: "hello", incoming: "hello" })).toBe("hello wor");
});
it("takes a remote text that differs from the last commit", () => {
  expect(nextDraft({ draft: "hello wor", lastCommitted: "hello", incoming: "bye" })).toBe("bye");
});
it("takes the incoming text when nothing was typed", () => {
  expect(nextDraft({ draft: "", lastCommitted: "", incoming: "loaded" })).toBe("loaded");
});
```

- [ ] **Step 2: Run `npm test`.** Expected: fails, `nextDraft` not found. If Vitest does not pick up files under `apps/web`, add the include pattern in the root config rather than moving the file.
- [ ] **Step 3: Implement `draft.ts`, then `TextEditor.tsx`.** The editor holds `draft` in state and `lastCommitted` in a ref initialised to `document.text`. An effect on `[document.id, document.text]` sets the draft to `nextDraft(...)` and then sets `lastCommitted` to `document.text`. `commit()` clears the timer and, when `draft !== document.text`, records `lastCommitted = draft` and calls `onChange({ kind: "set_text", value: draft })`. `onChange` of the textarea restarts a 300 ms timer; `onBlur` commits at once; unmount clears the timer. Markup: a `<section className="editor-card">` containing a label "Shared text" and a `<textarea maxLength={10000} rows={14} placeholder="Start typing…">`.
- [ ] **Step 4: Update the controller.** Rename the class, use `Document`, `DocumentReplica`, `projectDocument`, initial document `{ id, text: "" }`, snapshot field `document`. Delete both empty-title guards.
- [ ] **Step 5: Update `replica-store.ts`.** Types to `DocumentReplica`. Open the database at version 2; in `upgrade(db, oldVersion, _new, transaction)` create the three stores when `oldVersion < 1`, and when `oldVersion === 1` call `transaction.objectStore("replicas").clear()` and the same for `pendingOperations`.
- [ ] **Step 6: Update `App.tsx`, `api-client.ts`, `styles.css`, `index.html`, `sw.js`, `README.md`.**
  - Paths: `/rooms/` in both regexes and both `location.assign` calls.
  - Copy: eyebrow "Local-first shared text"; heading "Keep writing, even when the network does not."; lede "Converge preserves offline edits and deterministically converges every replica's text after reconnecting."; top bar "Converge room"; error fallback "Could not create room" (also in `api-client.ts`).
  - `index.html` description: "Converge local-first shared text box".
  - CSS: rename `.incident-card` to `.editor-card` in all three places; remove `.field-grid` and `.field-error` rules if nothing uses them; add a `textarea` rule matching the existing `input` styling with `resize: vertical` and `min-height: 240px`.
  - `sw.js`: bump `CACHE_NAME` to `converge-app-shell-v2` so the old shell is evicted.
  - `README.md` line 3: "Converge is a local-first shared text box. …" keeping the rest of the sentence.
- [ ] **Step 7: Run `npm run typecheck`, `npm test`, `npm run build:web`.** Expected: all pass, 8 tests.
- [ ] **Step 8: Run `grep -rin incident apps packages README.md --include='*.ts' --include='*.tsx' --include='*.css' --include='*.html' --include='*.go' --include='*.md'`.** Expected: no output.

### Task 4: End-to-end smoke check

**Files:** none.

- [ ] **Step 1: Restart the Go server** (it does not hot-reload) with the same three environment variables: `PORT=8080`, `DATABASE_URL=postgres://converge:converge@localhost:5433/converge?sslmode=disable`, `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174`. Vite reloads by itself.
- [ ] **Step 2: Create a room, submit, read back** with `curl`: `POST /api/v1/documents`; `POST /api/v1/documents/<id>/operations` with a `set_text` operation whose value is `"line one\nline two 😀"`; `GET /api/v1/documents/<id>/operations?after=0`. Expected: 201, then one stored operation with that exact value.
- [ ] **Step 3: Submit a `set_title` operation** to the same room. Expected: 400 `invalid_operation`.
- [ ] **Step 4: Fetch `http://localhost:5174/rooms/<id>`.** Expected: 200.
- [ ] **Step 5: Report** what passed, and that two-window and offline browser testing is deferred to the user.
