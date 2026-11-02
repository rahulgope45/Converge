import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";

import type { IncidentReplica, Operation } from "@converge/sync-core";

interface ConvergeDatabase extends DBSchema {
  replicas: {
    key: string;
    value: IncidentReplica;
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
    databasePromise = openDB<ConvergeDatabase>("converge", 1, {
      upgrade(db) {
        db.createObjectStore("replicas");
        const pending = db.createObjectStore("pendingOperations", {
          keyPath: "operationId",
        });
        pending.createIndex("documentId", "documentId");
        db.createObjectStore("settings");
      },
    });
  }
  return databasePromise;
}

export async function getActorId(): Promise<string> {
  // A browser tab is an independent replica. Reusing one persisted actor ID
  // across tabs makes concurrent operations with equal Lamport timestamps
  // indistinguishable and can prevent deterministic convergence.
  return crypto.randomUUID();
}

export async function loadReplica(
  documentId: string,
): Promise<IncidentReplica | undefined> {
  return (await database()).get("replicas", documentId);
}

export async function saveReplica(replica: IncidentReplica): Promise<void> {
  await (await database()).put("replicas", replica, replica.documentId);
}

export async function saveLocalOperation(
  replica: IncidentReplica,
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
