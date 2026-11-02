import { compareVersion } from "./compare-version.js";
import type {
  IncidentReplica,
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
  replica: IncidentReplica,
  operation: Operation,
): IncidentReplica {
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

  const nextReplica: IncidentReplica = {
    ...replica,
    localClock: Math.max(replica.localClock, operation.logicalTime),
    appliedOperationIds: [
      ...replica.appliedOperationIds,
      operation.operationId,
    ],
  };

  switch (operation.kind) {
    case "set_title":
      return {
        ...nextReplica,
        title: updateRegister(replica.title, operation.value, version),
      };
    case "set_status":
      return {
        ...nextReplica,
        status: updateRegister(replica.status, operation.value, version),
      };
    case "set_severity":
      return {
        ...nextReplica,
        severity: updateRegister(replica.severity, operation.value, version),
      };
  }
}
