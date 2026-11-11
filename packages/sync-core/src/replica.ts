import type { Document, DocumentReplica, Version } from "./model.js";

const initialVersion: Version = {
  logicalTime: 0,
  actorId: "",
};

export function createReplica(document: Document): DocumentReplica {
  return {
    documentId: document.id,
    text: { value: document.text, version: initialVersion },
    localClock: 0,
    lastServerSequence: 0,
    appliedOperationIds: [],
  };
}

export function projectDocument(replica: DocumentReplica): Document {
  return {
    id: replica.documentId,
    text: replica.text.value,
  };
}
