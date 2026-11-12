import { diffText } from "./diff.js";
import type {
  DeleteSpan,
  DocumentReplica,
  Element,
  Operation,
  TextEdit,
} from "./model.js";

// Limits the server enforces on one delete operation.
export const MAX_DELETE_SPANS = 1000;
export const MAX_DELETE_LENGTH = 10000;

// Groups the elements into runs of consecutive ids, split into as many
// lists as needed for each to fit in one delete operation.
function spanChunksOf(elements: readonly Element[]): DeleteSpan[][] {
  const chunks: DeleteSpan[][] = [];
  let spans: DeleteSpan[] = [];
  let length = 0;

  for (const { id } of elements) {
    const last = spans[spans.length - 1];
    const extendsLast =
      last !== undefined &&
      last.actorId === id.actorId &&
      last.from + last.length === id.logicalTime;

    if (
      length === MAX_DELETE_LENGTH ||
      (!extendsLast && spans.length === MAX_DELETE_SPANS)
    ) {
      chunks.push(spans);
      spans = [{ actorId: id.actorId, from: id.logicalTime, length: 1 }];
      length = 1;
      continue;
    }

    if (extendsLast) {
      last.length += 1;
    } else {
      spans.push({ actorId: id.actorId, from: id.logicalTime, length: 1 });
    }
    length += 1;
  }

  if (spans.length > 0) {
    chunks.push(spans);
  }
  return chunks;
}

// Describes a local change of the visible text as operations: the deletes
// (one unless the removed text exceeds a server limit) followed by at most
// one insert. The replica is not modified; the
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

  const removed = visible.slice(change.start, change.start + change.removed);
  for (const spans of spanChunksOf(removed)) {
    operations.push({
      operationId: newOperationId(),
      documentId: replica.documentId,
      actorId,
      logicalTime,
      kind: "delete_text",
      value: { spans },
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
