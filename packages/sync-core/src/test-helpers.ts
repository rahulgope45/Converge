import { applyOperation } from "./apply-operation.js";
import { createLocalOperations } from "./create-operation.js";
import type { DocumentReplica, Operation, TextEdit } from "./model.js";
import { createReplica, textOf } from "./replica.js";

export const DOCUMENT_ID = "doc-1";

let counter = 0;
export function nextOperationId(): string {
  counter += 1;
  return `op-${counter}`;
}

export function emptyReplica(): DocumentReplica {
  return createReplica(DOCUMENT_ID);
}

export function applyAll(
  replica: DocumentReplica,
  operations: readonly Operation[],
): DocumentReplica {
  return operations.reduce(applyOperation, replica);
}

// Performs a local edit on a replica the way the app does: create the
// operations, apply them, and hand them back for delivery elsewhere.
export function edit(
  replica: DocumentReplica,
  actorId: string,
  change: TextEdit,
): { replica: DocumentReplica; operations: Operation[] } {
  const operations = createLocalOperations(
    replica,
    actorId,
    nextOperationId,
    change,
  );
  return { replica: applyAll(replica, operations), operations };
}

// Inserts `text` at a code-point index of the replica's visible text.
export function insertAt(
  replica: DocumentReplica,
  actorId: string,
  index: number,
  text: string,
) {
  const points = Array.from(textOf(replica));
  const at = Math.min(index, points.length);
  const inserted = Array.from(text);
  return edit(replica, actorId, {
    text: [...points.slice(0, at), ...inserted, ...points.slice(at)].join(""),
    caret: at + inserted.length,
  });
}

export function deleteAt(
  replica: DocumentReplica,
  actorId: string,
  index: number,
  length: number,
) {
  const points = Array.from(textOf(replica));
  const at = Math.min(index, points.length);
  return edit(replica, actorId, {
    text: [...points.slice(0, at), ...points.slice(at + length)].join(""),
    caret: at,
  });
}
