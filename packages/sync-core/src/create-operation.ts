import { diffText } from "./diff.js";
import type {
  DeleteSpan,
  DocumentReplica,
  Element,
  Operation,
  TextEdit,
} from "./model.js";

function spansOf(elements: readonly Element[]): DeleteSpan[] {
  const spans: DeleteSpan[] = [];
  for (const { id } of elements) {
    const last = spans[spans.length - 1];
    if (
      last &&
      last.actorId === id.actorId &&
      last.from + last.length === id.logicalTime
    ) {
      last.length += 1;
    } else {
      spans.push({ actorId: id.actorId, from: id.logicalTime, length: 1 });
    }
  }
  return spans;
}

// Describes a local change of the visible text as operations: at most one
// delete followed by at most one insert. The replica is not modified; the
// caller applies the returned operations in order.
export function createLocalOperations(
  replica: DocumentReplica,
  actorId: string,
  newOperationId: () => string,
  edit: TextEdit,
): Operation[] {
  const visible = replica.elements.filter((element) => !element.deleted);
  const change = diffText(
    visible.map((element) => element.value),
    Array.from(edit.text),
    edit.caret,
  );

  const operations: Operation[] = [];
  let logicalTime = replica.localClock + 1;

  if (change.removed > 0) {
    operations.push({
      operationId: newOperationId(),
      documentId: replica.documentId,
      actorId,
      logicalTime,
      kind: "delete_text",
      value: {
        spans: spansOf(visible.slice(change.start, change.start + change.removed)),
      },
    });
    logicalTime += 1;
  }

  if (change.inserted.length > 0) {
    operations.push({
      operationId: newOperationId(),
      documentId: replica.documentId,
      actorId,
      logicalTime,
      kind: "insert_text",
      value: {
        after: change.start > 0 ? visible[change.start - 1]!.id : null,
        text: change.inserted.join(""),
      },
    });
  }

  return operations;
}
