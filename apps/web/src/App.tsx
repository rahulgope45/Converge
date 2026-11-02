import { useEffect, useMemo, useState } from "react";

import { ConnectionBadge } from "./components/ConnectionBadge.js";
import { IncidentEditor } from "./components/IncidentEditor.js";
import { createDocument } from "./sync/api-client.js";
import {
  IncidentSyncController,
  type SyncSnapshot,
} from "./sync/controller.js";

function documentIdFromPath(): string | undefined {
  return window.location.pathname.match(/^\/incidents\/([^/]+)$/)?.[1];
}

export default function App() {
  const documentId = documentIdFromPath();
  const controller = useMemo(
    () => (documentId ? new IncidentSyncController(documentId) : undefined),
    [documentId],
  );
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({
    connection: "loading",
    pendingCount: 0,
    lastServerSequence: 0,
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

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
      window.location.assign(`/incidents/${id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create incident");
      setCreating(false);
    }
  }

  if (!documentId) {
    return (
      <main className="shell shell--landing">
        <div className="brand-mark">C</div>
        <p className="eyebrow">Local-first incident response</p>
        <h1>Keep coordinating, even when the network does not.</h1>
        <p className="lede">
          Converge preserves offline edits and deterministically merges concurrent
          incident updates after reconnecting.
        </p>
        <button className="primary-button" disabled={creating} onClick={handleCreate}>
          {creating ? "Creating…" : "Create an incident"}
        </button>
        {createError && <p className="error-message">{createError}</p>}
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Converge incident room</p>
          <p className="document-id">{documentId}</p>
        </div>
        <ConnectionBadge state={snapshot.connection} />
      </header>

      {snapshot.incident ? (
        <IncidentEditor
          incident={snapshot.incident}
          onChange={(change) => controller?.change(change)}
        />
      ) : (
        <section className="incident-card">Loading local replica…</section>
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
