export { anchorAt, indexOfAnchor } from "./anchors.js";
export { applyOperation } from "./apply-operation.js";
export { compareVersion } from "./compare-version.js";
export {
  createLocalOperations,
  MAX_DELETE_LENGTH,
  MAX_DELETE_SPANS,
} from "./create-operation.js";
export { createReplica, projectDocument, textOf } from "./replica.js";
export type {
  CharId,
  DeleteSpan,
  DeleteTextOperation,
  Document,
  DocumentReplica,
  Element,
  InsertTextOperation,
  Operation,
  TextEdit,
  Version,
} from "./model.js";
