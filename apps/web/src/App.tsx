import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { TextEditor } from "./components/TextEditor.js";
import { createDocument } from "./sync/api-client.js";
import {
  DocumentSyncController,
  type SyncSnapshot,
} from "./sync/controller.js";

function documentIdFromPath(): string | undefined {
  return window.location.pathname.match(/^\/rooms\/([^/]+)$/)?.[1];
}

const documentIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function documentIdFromRoomInput(value: string): string | undefined {
  const input = value.trim();
  if (documentIdPattern.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    const id = url.pathname.match(/^\/rooms\/([^/]+)\/?$/)?.[1];
    return id && documentIdPattern.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export default function App() {
  const documentId = documentIdFromPath();
  const controller = useMemo(
    () => (documentId ? new DocumentSyncController(documentId) : undefined),
    [documentId],
  );
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({
    connection: "loading",
    pendingCount: 0,
    queuedLocalChanges: 0,
    lastServerSequence: 0,
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [roomInput, setRoomInput] = useState("");
  const [joinError, setJoinError] = useState<string>();
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!controller) {
      return;
    }
    const unsubscribe = controller.subscribe(setSnapshot);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(undefined);
    try {
      const id = await createDocument();
      window.location.assign(`/rooms/${id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create room");
      setCreating(false);
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = documentIdFromRoomInput(roomInput);
    if (!id) {
      setJoinError("Paste a valid room link or room ID.");
      return;
    }

    setJoinError(undefined);
    window.location.assign(`/rooms/${id}`);
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 2_000);
    } catch {
      setShareState("error");
    }
  }

  if (!documentId) {
    return (
      <main className="shell shell--landing">
        <div className="brand-mark">C</div>
        <p className="eyebrow">Local-first shared text</p>
        <h1>Keep writing, even when the network does not.</h1>
        <p className="lede">
          Converge preserves offline edits and deterministically converges every
          replica's text after reconnecting.
        </p>
        <div className="landing-actions">
          <div>
            <button
              className="primary-button"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? "Creating…" : "Create a room"}
            </button>
            {createError && <p className="error-message">{createError}</p>}
          </div>

          <div className="join-card">
            <p>Already have a room?</p>
            <form className="join-form" onSubmit={handleJoin}>
              <input
                aria-label="Room link or room ID"
                placeholder="Paste room link or ID"
                value={roomInput}
                onChange={(event) => {
                  setRoomInput(event.target.value);
                  setJoinError(undefined);
                }}
              />
              <button className="secondary-button" type="submit">
                Join room
              </button>
            </form>
            {joinError && <p className="error-message">{joinError}</p>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Converge room</p>
          <p className="document-id">{documentId}</p>
        </div>
        <div className="room-actions">
          {(snapshot.connection === "offline" ||
            snapshot.connection === "error") && (
            <button
              className="secondary-button"
              onClick={() => controller?.retry()}
            >
              Refresh connection
            </button>
          )}
          <button className="secondary-button" onClick={handleShare}>
            {shareState === "copied" ? "Link copied" : "Share room"}
          </button>
          <ConnectionBadge state={snapshot.connection} />
        </div>
      </header>

      {shareState === "error" && (
        <p className="error-message">
          Could not copy the link. Copy it from the address bar instead.
        </p>
      )}

      {snapshot.document ? (
        <TextEditor
          document={snapshot.document}
          queuedLocalChanges={snapshot.queuedLocalChanges}
          onChange={(change) => controller?.change(change)}
        />
      ) : (
        <section className="editor-card">Loading local replica…</section>
      )}

      <section className="sync-panel" aria-label="Synchronization details">
        <div>
          <span>Pending operations</span>
          <strong>{snapshot.pendingCount}</strong>
        </div>
        <div>
          <span>Server sequence</span>
          <strong>{snapshot.lastServerSequence}</strong>
        </div>
      </section>

      {snapshot.error && <p className="error-message">{snapshot.error}</p>}
    </main>
  );
}
