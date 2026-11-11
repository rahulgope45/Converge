import type { Document, DocumentReplica } from "./model.js";

export function createReplica(documentId: string): DocumentReplica {
  return {
    documentId,
    elements: [],
    localClock: 0,
    lastServerSequence: 0,
    orphans: [],
  };
}

export function textOf(replica: DocumentReplica): string {
  let text = "";
  for (const element of replica.elements) {
    if (!element.deleted) {
      text += element.value;
    }
  }
  return text;
}

export function projectDocument(replica: DocumentReplica): Document {
  return { id: replica.documentId, text: textOf(replica) };
}
