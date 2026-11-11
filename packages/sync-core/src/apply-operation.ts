import { compareVersion } from "./compare-version.js";
import type {
  DocumentReplica,
  Operation,
  Register,
  Version,
} from "./model.js";

function updateRegister<T>(
  current: Register<T>,
  value: T,
  incomingVersion: Version,
): Register<T> {
  if (compareVersion(incomingVersion, current.version) <= 0) {
    return current;
  }

  return { value, version: incomingVersion };
}

export function applyOperation(
  replica: DocumentReplica,
  operation: Operation,
): DocumentReplica {
  if (operation.documentId !== replica.documentId) {
    throw new Error(
      `Operation for ${operation.documentId} cannot be applied to ${replica.documentId}`,
    );
  }

  if (replica.appliedOperationIds.includes(operation.operationId)) {
    return replica;
  }

  const version: Version = {
    logicalTime: operation.logicalTime,
    actorId: operation.actorId,
  };

  const nextReplica: DocumentReplica = {
    ...replica,
    localClock: Math.max(replica.localClock, operation.logicalTime),
    appliedOperationIds: [
      ...replica.appliedOperationIds,
      operation.operationId,
    ],
  };

  // Rooms created before the text box hold operations of other kinds.
  // They are acknowledged so catch-up advances, but they change no state.
  if (operation.kind !== "set_text") {
    return nextReplica;
  }

  return {
    ...nextReplica,
    text: updateRegister(replica.text, operation.value, version),
  };
}
