import {
  anchorAt,
  applyOperation,
  createLocalOperations,
  createReplica,
  indexOfAnchor,
  textOf,
} from "@converge/sync-core";
import type { CharId, DocumentReplica } from "@converge/sync-core";

import {
  getActorId,
  listPendingOperations,
  loadReplica,
  removePendingOperations,
  saveLocalOperations,
  saveReplica,
} from "../storage/replica-store.js";
import {
  sanitizeText,
  toCodePointIndex,
  toUtf16Offset,
} from "../text-offsets.js";
import {
  fetchOperations,
  MAX_BATCH_SIZE,
  operationStreamURL,
  submitOperations,
} from "./api-client.js";
import type { StoredOperation } from "./api-client.js";
import { identityFor, parseServerFrame, presenceFrame } from "./presence.js";
import type { Peer } from "./presence.js";

export type ConnectionState =
  | "loading"
  | "offline"
  | "synchronizing"
  | "online"
  | "error";

// Positions in a snapshot are UTF-16 offsets into `text`, as the DOM uses.
export type PeerView = {
  actorId: string;
  name: string;
  color: string;
  // Undefined when the peer has no caret, or it sits on a character this
  // replica has not received yet.
  offset?: number;
};

export type SyncSnapshot = {
  // Undefined until the local replica has been loaded.
  text?: string;
  selection?: { start: number; end: number };
  self?: { name: string; color: string };
  peers: PeerView[];
  connection: ConnectionState;
  pendingCount: number;
  lastServerSequence: number;
  error?: string;
};

type Listener = (snapshot: SyncSnapshot) => void;

const PRESENCE_INTERVAL_MS = 100;
const CATCH_UP_DELAY_MS = 250;

export const initialSnapshot: SyncSnapshot = {
  peers: [],
  connection: "loading",
  pendingCount: 0,
  lastServerSequence: 0,
};

export class DocumentSyncController {
  private actorId = "";
  private replica?: DocumentReplica;
  private socket?: WebSocket;
  private stopped = false;

  private connection: ConnectionState = "loading";
  private error?: string;
  private pendingCount = 0;
  private selection?: { start: CharId | null; end: CharId | null };
  private readonly peers = new Map<string, Peer>();

  private retryAttempt = 0;
  private retryTimer?: number;
  private catchUpTimer?: number;
  private presenceTimer?: number;
  private lastPresenceAt = 0;

  // Storage and network work runs one task at a time, in order. Edits and
  // incoming operations are applied to the in-memory replica immediately and
  // never wait for this queue.
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private snapshot: SyncSnapshot = initialSnapshot;

  private readonly handleOffline = () => {
    // Browsers only allow close codes 1000 and 3000-4999.
    this.socket?.close(1000, "network offline");
    this.setConnection("offline");
    this.scheduleReconnect();
  };
  private readonly handleOnline = () => this.retry();

  constructor(private readonly documentId: string) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    void this.enqueue(async () => {
      this.actorId = await getActorId();
      this.replica =
        (await loadReplica(this.documentId)) ?? createReplica(this.documentId);
      this.pendingCount = (await listPendingOperations(this.documentId)).length;
      await saveReplica(this.replica);
      this.setConnection("offline");
      await this.synchronize();
    });
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    for (const timer of [this.retryTimer, this.catchUpTimer, this.presenceTimer]) {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    }
    this.socket?.close(1000, "controller stopped");
  }

  retry(): void {
    if (this.stopped) {
      return;
    }

    if (this.retryTimer !== undefined) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.retryAttempt = 0;
    void this.enqueue(() => this.synchronize());
  }

  // Replaces the visible text after the user typed, pasted or deleted.
  // `caret` is the textarea's caret after the change, as a UTF-16 offset.
  // The change is applied before this method returns.
  edit(text: string, caret: number): void {
    if (!this.replica) {
      return;
    }

    const clean = sanitizeText(text);
    const caretIndex = toCodePointIndex(clean, caret);
    const operations = createLocalOperations(
      this.replica,
      this.actorId,
      () => crypto.randomUUID(),
      // A caret measured on text that sanitizing changed may be off, so it is
      // only used as a hint when the text is exactly what the user typed.
      { text: clean, caret: clean === text ? caretIndex : undefined },
    );

    let replica = this.replica;
    for (const operation of operations) {
      replica = applyOperation(replica, operation);
    }
    this.replica = replica;
    this.pendingCount += operations.length;

    const anchor = anchorAt(replica, caretIndex);
    this.selection = { start: anchor, end: anchor };

    if (operations.length === 0) {
      this.emit();
      this.schedulePresence();
      return;
    }

    // Started in this tick so that no later write can persist the replica
    // without the operations still owed to the server.
    const saved = saveLocalOperations(replica, operations);
    if (this.connection !== "error") {
      this.connection = navigator.onLine ? "synchronizing" : "offline";
    }
    this.emit();
    this.schedulePresence();

    void this.enqueue(async () => {
      await saved;
      if (navigator.onLine) {
        await this.flushPending();
        this.setConnection(
          this.socket?.readyState === WebSocket.OPEN ? "online" : "synchronizing",
        );
      }
    });
  }

  // Records where the user's selection is, as UTF-16 offsets, so it can be
  // kept on the same characters when other replicas change the text.
  setSelection(start: number, end: number): void {
    if (!this.replica) {
      return;
    }

    const text = textOf(this.replica);
    this.selection = {
      start: anchorAt(this.replica, toCodePointIndex(text, start)),
      end: anchorAt(this.replica, toCodePointIndex(text, end)),
    };
    this.schedulePresence();
  }

  private async synchronize(): Promise<void> {
    if (this.stopped || !this.replica) {
      return;
    }

    if (!navigator.onLine) {
      this.setConnection("offline");
      this.scheduleReconnect();
      return;
    }

    this.setConnection("synchronizing");
    try {
      await this.catchUp();
      await this.flushPending();
      await this.openSocket();
      await this.catchUp();
      this.retryAttempt = 0;
      this.setConnection("online");
    } catch (error) {
      this.setConnection("error", messageFrom(error));
      this.scheduleReconnect();
    }
  }

  private async catchUp(): Promise<void> {
    let hasMore = true;
    while (hasMore && this.replica) {
      const page = await fetchOperations(
        this.documentId,
        this.replica.lastServerSequence,
      );
      for (const stored of page.operations) {
        this.applyStored(stored, true);
      }
      hasMore = page.hasMore;
      this.emit();
      await saveReplica(this.replica);
    }
  }

  private async flushPending(): Promise<void> {
    for (;;) {
      const pending = await listPendingOperations(this.documentId);
      if (pending.length === 0) {
        this.pendingCount = 0;
        this.emit();
        return;
      }

      // Logical-time order guarantees the server stores an operation after
      // every earlier local operation it refers to.
      pending.sort((left, right) => left.logicalTime - right.logicalTime);
      const batch = pending.slice(0, MAX_BATCH_SIZE);
      await submitOperations(this.documentId, batch);
      await removePendingOperations(batch.map((operation) => operation.operationId));
      this.pendingCount = Math.max(0, this.pendingCount - batch.length);
      this.emit();
    }
  }

  private openSocket(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }

    this.socket?.close(1000, "reconnecting");
    const socket = new WebSocket(operationStreamURL(this.documentId));
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let opened = false;

      socket.onopen = () => {
        opened = true;
        this.sendPresence();
        resolve();
      };

      socket.onmessage = (event) => {
        if (this.socket === socket) {
          this.handleFrame(String(event.data));
        }
      };

      socket.onclose = () => {
        if (!opened) {
          reject(new Error("Could not open real-time connection"));
        }
        if (this.socket === socket && !this.stopped) {
          this.socket = undefined;
          this.peers.clear();
          this.setConnection("offline");
          if (opened) {
            this.scheduleReconnect();
          }
        }
      };

      socket.onerror = () => socket.close();
    });
  }

  private handleFrame(data: string): void {
    const frame = parseServerFrame(data);
    if (!frame || !this.replica) {
      return;
    }

    switch (frame.kind) {
      case "operation":
        // Shown at once. The stream gives no guarantee that nothing was
        // missed, so the cursor only advances through catch-up, which is
        // scheduled once for a burst of frames.
        this.applyStored(frame.stored, false);
        this.emit();
        this.scheduleCatchUp();
        break;
      case "presence":
        if (frame.peer.actorId !== this.actorId) {
          this.peers.set(frame.peer.actorId, frame.peer);
          this.emit();
        }
        break;
      case "leave":
        if (this.peers.delete(frame.actorId)) {
          this.emit();
        }
        break;
    }
  }

  private applyStored(stored: StoredOperation, advanceCursor: boolean): void {
    if (!this.replica) {
      return;
    }

    this.replica = {
      ...applyOperation(this.replica, stored.operation),
      lastServerSequence: advanceCursor
        ? Math.max(this.replica.lastServerSequence, stored.serverSequence)
        : this.replica.lastServerSequence,
    };
  }

  private scheduleCatchUp(): void {
    if (this.stopped || this.catchUpTimer !== undefined) {
      return;
    }

    this.catchUpTimer = window.setTimeout(() => {
      this.catchUpTimer = undefined;
      void this.enqueue(() => this.catchUp());
    }, CATCH_UP_DELAY_MS);
  }

  private schedulePresence(): void {
    if (this.stopped || this.presenceTimer !== undefined) {
      return;
    }

    const wait = Math.max(
      0,
      this.lastPresenceAt + PRESENCE_INTERVAL_MS - Date.now(),
    );
    this.presenceTimer = window.setTimeout(() => {
      this.presenceTimer = undefined;
      this.sendPresence();
    }, wait);
  }

  private sendPresence(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.actorId) {
      return;
    }

    this.lastPresenceAt = Date.now();
    this.socket.send(presenceFrame(this.actorId, this.selection?.end));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== undefined) {
      return;
    }

    const baseDelay = Math.min(30_000, 1000 * 2 ** this.retryAttempt);
    const delay = baseDelay + Math.floor(Math.random() * 500);
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.enqueue(() => this.synchronize());
    }, delay);
  }

  private setConnection(connection: ConnectionState, error?: string): void {
    this.connection = connection;
    this.error = error;
    this.emit();
  }

  private emit(): void {
    const replica = this.replica;
    const text = replica ? textOf(replica) : undefined;

    const offsetOf = (anchor: CharId | null | undefined): number | undefined => {
      if (!replica || text === undefined || anchor === undefined) {
        return undefined;
      }
      const index = indexOfAnchor(replica, anchor);
      return index === undefined ? undefined : toUtf16Offset(text, index);
    };

    const start = offsetOf(this.selection?.start);
    const end = offsetOf(this.selection?.end);

    this.snapshot = {
      text,
      selection:
        start === undefined || end === undefined
          ? undefined
          : { start: Math.min(start, end), end: Math.max(start, end) },
      self: this.actorId ? identityFor(this.actorId) : undefined,
      peers: [...this.peers.values()].map((peer) => ({
        actorId: peer.actorId,
        name: peer.name,
        color: peer.color,
        offset: offsetOf(peer.anchor),
      })),
      connection: this.connection,
      pendingCount: this.pendingCount,
      lastServerSequence: replica?.lastServerSequence ?? 0,
      error: this.error,
    };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch((error) => {
      this.setConnection("error", messageFrom(error));
      this.scheduleReconnect();
    });
    return next;
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected synchronization error";
}
