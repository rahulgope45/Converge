export type Document = {
  id: string;
  text: string;
};

export type Version = {
  logicalTime: number;
  actorId: string;
};

export type Register<T> = {
  value: T;
  version: Version;
};

export type DocumentReplica = {
  documentId: string;
  text: Register<string>;
  localClock: number;
  lastServerSequence: number;
  appliedOperationIds: readonly string[];
};

export type SetTextOperation = {
  operationId: string;
  documentId: string;
  actorId: string;
  logicalTime: number;
  kind: "set_text";
  value: string;
};

export type Operation = SetTextOperation;
