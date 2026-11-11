import type { DocumentReplica, Operation } from "./model.js";

export type LocalChange = { kind: "set_text"; value: string };

export function createLocalOperation(
  replica: DocumentReplica,
  actorId: string,
  operationId: string,
  change: LocalChange,
): Operation {
  return {
    operationId,
    documentId: replica.documentId,
    actorId,
    logicalTime: replica.localClock + 1,
    kind: change.kind,
    value: change.value,
  };
}
