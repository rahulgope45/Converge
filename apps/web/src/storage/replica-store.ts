import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";

import type { DocumentReplica, Operation } from "@converge/sync-core";

interface ConvergeDatabase extends DBSchema {
  replicas: {
    key: string;
    value: DocumentReplica;
  };
  pendingOperations: {
    key: string;
    value: Operation;
    indexes: { documentId: string };
  };
  settings: {
    key: string;
    value: string;
  };
}

let databasePromise: Promise<IDBPDatabase<ConvergeDatabase>> | undefined;

function database(): Promise<IDBPDatabase<ConvergeDatabase>> {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }
  return databasePromise;
}

function openDatabase(): Promise<IDBPDatabase<ConvergeDatabase>> {
  return new Promise((resolve, reject) => {
    const opening = openDB<ConvergeDatabase>("converge", 3, {
      blocked() {
        // Another tab still holds the previous database version, so this
        // open would otherwise wait silently for that tab to close.
        reject(
          new Error(
            "Converge is open in another tab with an older version. Close or reload that tab, then reload this one.",
          ),
        );
      },
      blocking() {
        // A newer version of the app is opening the database in another tab.
        databasePromise = undefined;
        void opening.then((db) => db.close());
      },
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore("replicas");
          const pending = db.createObjectStore("pendingOperations", {
            keyPath: "operationId",
          });
          pending.createIndex("documentId", "documentId");
          db.createObjectStore("settings");
        }
        if (oldVersion >= 1 && oldVersion < 3) {
          // Earlier versions stored replicas and operations in shapes that
          // the character-level text model cannot read.
          void transaction.objectStore("replicas").clear();
          void transaction.objectStore("pendingOperations").clear();
        }
      },
    });
    opening.then(resolve, reject);
  });
}

export async function getActorId(): Promise<string> {
  // A browser tab is an independent replica. Reusing one persisted actor ID
  // across tabs makes concurrent operations with equal Lamport timestamps
  // indistinguishable and can prevent deterministic convergence.
  return crypto.randomUUID();
}

export async function loadReplica(
  documentId: string,
): Promise<DocumentReplica | undefined> {
  return (await database()).get("replicas", documentId);
}

export async function saveReplica(replica: DocumentReplica): Promise<void> {
  await (await database()).put("replicas", replica, replica.documentId);
}

// Stores a replica together with the local operations that produced it, in
// one transaction, so the replica is never persisted without the operations
// still owed to the server.
export async function saveLocalOperations(
  replica: DocumentReplica,
  operations: readonly Operation[],
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(
    ["replicas", "pendingOperations"],
    "readwrite",
  );
  const pending = transaction.objectStore("pendingOperations");
  await Promise.all([
    transaction.objectStore("replicas").put(replica, replica.documentId),
    ...operations.map((operation) => pending.put(operation)),
    transaction.done,
  ]);
}

export async function listPendingOperations(
  documentId: string,
): Promise<Operation[]> {
  return (await database()).getAllFromIndex(
    "pendingOperations",
    "documentId",
    documentId,
  );
}

export async function removePendingOperations(
  operationIds: readonly string[],
): Promise<void> {
  const db = await database();
  const transaction = db.transaction("pendingOperations", "readwrite");
  await Promise.all([
    ...operationIds.map((operationId) => transaction.store.delete(operationId)),
    transaction.done,
  ]);
}
