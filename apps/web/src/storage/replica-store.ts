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
    const opening = openDB<ConvergeDatabase>("converge", 2, {
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
        if (oldVersion === 1) {
          // Version 1 stored replicas and operations in an older shape that
          // the shared text model cannot read.
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

export async function saveLocalOperation(
  replica: DocumentReplica,
  operation: Operation,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(
    ["replicas", "pendingOperations"],
    "readwrite",
  );
  await Promise.all([
    transaction.objectStore("replicas").put(replica, replica.documentId),
    transaction.objectStore("pendingOperations").put(operation),
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

export async function removePendingOperation(
  operationId: string,
): Promise<void> {
  await (await database()).delete("pendingOperations", operationId);
}
