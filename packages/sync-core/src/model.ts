export type Document = {
  id: string;
  text: string;
};

export type Version = {
  logicalTime: number;
  actorId: string;
};

// Identifies one character forever. Ordered by logical time, then actor.
export type CharId = Version;

export type Element = {
  id: CharId;
  // Exactly one Unicode code point.
  value: string;
  deleted: boolean;
};

export type DocumentReplica = {
  documentId: string;
  // Document order. Deleted elements stay as tombstones so that later
  // operations can still be placed relative to them.
  elements: readonly Element[];
  localClock: number;
  lastServerSequence: number;
  // Operations received before the characters they depend on.
  orphans: readonly Operation[];
};

type OperationMetadata = {
  operationId: string;
  documentId: string;
  actorId: string;
  logicalTime: number;
};

// Inserts a run of characters. The i-th code point of `text` gets the id
// (logicalTime + i, actorId). `after: null` is the start of the document.
export type InsertTextOperation = OperationMetadata & {
  kind: "insert_text";
  value: { after: CharId | null; text: string };
};

export type DeleteSpan = {
  actorId: string;
  from: number;
  length: number;
};

// Deletes the characters with ids (from .. from + length - 1, actorId).
export type DeleteTextOperation = OperationMetadata & {
  kind: "delete_text";
  value: { spans: DeleteSpan[] };
};

export type Operation = InsertTextOperation | DeleteTextOperation;

// A new visible text for the document. `caret` is the code-point index of
// the caret after the change, used to locate edits inside repeated text.
export type TextEdit = {
  text: string;
  caret?: number;
};
