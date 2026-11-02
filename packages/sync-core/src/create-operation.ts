import type { IncidentReplica, Operation } from "./model.js";

export type LocalChange =
  | { kind: "set_title"; value: string }
  | { kind: "set_status"; value: "investigating" | "identified" | "monitoring" | "resolved" }
  | { kind: "set_severity"; value: "SEV1" | "SEV2" | "SEV3" };

export function createLocalOperation(
  replica: IncidentReplica,
  actorId: string,
  operationId: string,
  change: LocalChange,
): Operation {
  const metadata = {
    operationId,
    documentId: replica.documentId,
    actorId,
    logicalTime: replica.localClock + 1,
  };

  switch (change.kind) {
    case "set_title":
      return { ...metadata, kind: change.kind, value: change.value };
    case "set_status":
      return { ...metadata, kind: change.kind, value: change.value };
    case "set_severity":
      return { ...metadata, kind: change.kind, value: change.value };
  }
}
