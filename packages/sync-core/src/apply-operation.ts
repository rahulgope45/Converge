import { compareVersion } from "./compare-version.js";
import type {
  CharId,
  DeleteTextOperation,
  DocumentReplica,
  Element,
  InsertTextOperation,
  Operation,
} from "./model.js";

function sameId(left: CharId, right: CharId): boolean {
  return left.logicalTime === right.logicalTime && left.actorId === right.actorId;
}

function positionOf(elements: readonly Element[], id: CharId): number {
  return elements.findIndex((element) => sameId(element.id, id));
}

function idKey(logicalTime: number, actorId: string): string {
  return `${logicalTime}:${actorId}`;
}

// Each integrate function returns the next replica, or undefined when the
// operation depends on a character this replica has not received yet.

function integrateInsert(
  replica: DocumentReplica,
  operation: InsertTextOperation,
): DocumentReplica | undefined {
  const points = Array.from(operation.value.text);
  const firstId: CharId = {
    logicalTime: operation.logicalTime,
    actorId: operation.actorId,
  };
  const localClock = Math.max(
    replica.localClock,
    operation.logicalTime + Math.max(points.length, 1) - 1,
  );

  if (points.length === 0 || positionOf(replica.elements, firstId) !== -1) {
    return { ...replica, localClock };
  }

  let index = 0;
  if (operation.value.after !== null) {
    const parent = positionOf(replica.elements, operation.value.after);
    if (parent === -1) {
      return undefined;
    }
    index = parent + 1;
  }

  // RGA placement: among inserts after the same character, the one with the
  // greater id comes first. Everything skipped here is either such an insert
  // or text typed after it, whose ids are greater still.
  while (
    index < replica.elements.length &&
    compareVersion(replica.elements[index]!.id, firstId) > 0
  ) {
    index += 1;
  }

  const run: Element[] = points.map((value, offset) => ({
    id: { logicalTime: operation.logicalTime + offset, actorId: operation.actorId },
    value,
    deleted: false,
  }));

  return {
    ...replica,
    localClock,
    elements: [
      ...replica.elements.slice(0, index),
      ...run,
      ...replica.elements.slice(index),
    ],
  };
}

function integrateDelete(
  replica: DocumentReplica,
  operation: DeleteTextOperation,
): DocumentReplica | undefined {
  const targets = new Set<string>();
  for (const span of operation.value.spans) {
    for (let offset = 0; offset < span.length; offset += 1) {
      targets.add(idKey(span.from + offset, span.actorId));
    }
  }

  let found = 0;
  const elements = replica.elements.map((element) => {
    if (!targets.has(idKey(element.id.logicalTime, element.id.actorId))) {
      return element;
    }
    found += 1;
    return element.deleted ? element : { ...element, deleted: true };
  });

  if (found < targets.size) {
    return undefined;
  }

  return {
    ...replica,
    elements,
    localClock: Math.max(replica.localClock, operation.logicalTime),
  };
}

function integrate(
  replica: DocumentReplica,
  operation: Operation,
): DocumentReplica | undefined {
  switch (operation.kind) {
    case "insert_text":
      return integrateInsert(replica, operation);
    case "delete_text":
      return integrateDelete(replica, operation);
    default: {
      // Rooms created by earlier versions hold operations of other kinds.
      // They carry no text for this model but still advance the clock.
      const legacy = operation as { logicalTime: number };
      return {
        ...replica,
        localClock: Math.max(replica.localClock, legacy.logicalTime),
      };
    }
  }
}

function retryOrphans(replica: DocumentReplica): DocumentReplica {
  let current = replica;
  let progressed = true;

  while (progressed && current.orphans.length > 0) {
    progressed = false;
    for (const orphan of current.orphans) {
      const next = integrate(current, orphan);
      if (next) {
        current = {
          ...next,
          orphans: next.orphans.filter(
            (candidate) => candidate.operationId !== orphan.operationId,
          ),
        };
        progressed = true;
        break;
      }
    }
  }

  return current;
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

  const next = integrate(replica, operation);
  if (!next) {
    const alreadyHeld = replica.orphans.some(
      (orphan) => orphan.operationId === operation.operationId,
    );
    return alreadyHeld
      ? replica
      : { ...replica, orphans: [...replica.orphans, operation] };
  }

  return retryOrphans(next);
}
