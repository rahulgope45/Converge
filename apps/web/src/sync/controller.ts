import {
  applyOperation,
  createLocalOperation,
  createReplica,
  projectDocument,
} from "@converge/sync-core";
import type {
  Document,
  DocumentReplica,
  LocalChange,
  Operation,
} from "@converge/sync-core";

import {
  getActorId,
  listPendingOperations,
  loadReplica,
  removePendingOperation,
  saveLocalOperation,
  saveReplica,
} from "../storage/replica-store.js";
import {
  fetchOperations,
  operationStreamURL,
  submitOperation,
} from "./api-client.js";
import type { StoredOperation } from "./api-client.js";

export type ConnectionState =
  | "loading"
  | "offline"
  | "synchronizing"
  | "online"
  | "error";

export type SyncSnapshot = {
  document?: Document;
  connection: ConnectionState;
  pendingCount: number;
  // Local changes accepted by change() that are not yet applied to the replica.
  queuedLocalChanges: number;
  lastServerSequence: number;
  error?: string;
};

type Listener = (snapshot: SyncSnapshot) => void;

const initialDocument = (documentId: string): Document => ({
  id: documentId,
  text: "",
});

export class DocumentSyncController {
  private actorId = "";
  private replica?: DocumentReplica;
  private socket?: WebSocket;
  private stopped = false;
  private retryAttempt = 0;
  private queuedLocalChanges = 0;
  private retryTimer?: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private snapshot: SyncSnapshot = {
    connection: "loading",
    pendingCount: 0,
    queuedLocalChanges: 0,
    lastServerSequence: 0,
  };
  private readonly handleOffline = () => {
    this.socket?.close(1001, "network offline");
    void this.enqueue(async () => {
      await this.refreshSnapshot("offline");
      this.scheduleReconnect();
    });
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
        (await loadReplica(this.documentId)) ??
        createReplica(initialDocument(this.documentId));
      await saveReplica(this.replica);
      await this.refreshSnapshot("offline");
      await this.synchronize();
    });
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    if (this.retryTimer !== undefined) {
      window.clearTimeout(this.retryTimer);
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

  change(change: LocalChange): void {
    this.queuedLocalChanges += 1;
    void this.enqueue(async () => {
      this.queuedLocalChanges -= 1;
      if (!this.replica) {
        return;
      }

      const operation = createLocalOperation(
        this.replica,
        this.actorId,
        crypto.randomUUID(),
        change,
      );
      this.replica = applyOperation(this.replica, operation);
      await saveLocalOperation(this.replica, operation);
      await this.refreshSnapshot(navigator.onLine ? "synchronizing" : "offline");

      if (navigator.onLine) {
        await this.flushPending();
        await this.refreshSnapshot(this.socket?.readyState === WebSocket.OPEN ? "online" : "synchronizing");
      }
    });
  }

  private async synchronize(): Promise<void> {
    if (this.stopped || !this.replica) {
      return;
    }

    if (!navigator.onLine) {
      await this.refreshSnapshot("offline");
      this.scheduleReconnect();
      return;
    }

    await this.refreshSnapshot("synchronizing");
    try {
      await this.catchUp();
      await this.flushPending();
      await this.openSocket();
      await this.catchUp();
      this.retryAttempt = 0;
      await this.refreshSnapshot("online");
    } catch (error) {
      await this.refreshSnapshot("error", messageFrom(error));
      this.scheduleReconnect();
    }
  }

  private async catchUp(): Promise<void> {
    if (!this.replica) {
      return;
    }

    let hasMore = true;
    while (hasMore) {
      const page = await fetchOperations(
        this.documentId,
        this.replica.lastServerSequence,
      );
      for (const stored of page.operations) {
        this.applyStored(stored, true);
      }
      hasMore = page.hasMore;
      await saveReplica(this.replica);
    }
  }

  private async flushPending(): Promise<void> {
    if (!this.replica) {
      return;
    }

    const pending = await listPendingOperations(this.documentId);
    pending.sort((left, right) => left.logicalTime - right.logicalTime);
    for (const operation of pending) {
      await submitOperation(operation);
      await removePendingOperation(operation.operationId);
      await saveReplica(this.replica);
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
        resolve();
      };

      socket.onmessage = (event) => {
        void this.enqueue(async () => {
          if (this.socket !== socket || !this.replica) {
            return;
          }
          const stored = JSON.parse(String(event.data)) as StoredOperation;
          this.applyStored(stored, false);
          await saveReplica(this.replica);
          await this.catchUp();
          await this.refreshSnapshot("online");
        });
      };

      socket.onclose = () => {
        if (!opened) {
          reject(new Error("Could not open real-time connection"));
        }
        if (this.socket === socket && !this.stopped) {
          this.socket = undefined;
          void this.refreshSnapshot("offline");
          if (opened) {
            this.scheduleReconnect();
          }
        }
      };

      socket.onerror = () => socket.close();
    });
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

  private async refreshSnapshot(
    connection: ConnectionState,
    error?: string,
  ): Promise<void> {
    const pendingCount = (
      await listPendingOperations(this.documentId)
    ).length;
    this.snapshot = {
      document: this.replica ? projectDocument(this.replica) : undefined,
      connection,
      pendingCount,
      queuedLocalChanges: this.queuedLocalChanges,
      lastServerSequence: this.replica?.lastServerSequence ?? 0,
      error,
    };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(async (error) => {
      await this.refreshSnapshot("error", messageFrom(error));
      this.scheduleReconnect();
    });
    return next;
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected synchronization error";
}
