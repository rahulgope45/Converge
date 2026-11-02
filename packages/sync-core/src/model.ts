export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3";

export type Incident = {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
};

export type Version = {
  logicalTime: number;
  actorId: string;
};

export type Register<T> = {
  value: T;
  version: Version;
};

export type IncidentReplica = {
  documentId: string;
  title: Register<string>;
  status: Register<IncidentStatus>;
  severity: Register<IncidentSeverity>;
  localClock: number;
  lastServerSequence: number;
  appliedOperationIds: readonly string[];
};

type OperationMetadata = {
  operationId: string;
  documentId: string;
  actorId: string;
  logicalTime: number;
};

export type SetTitleOperation = OperationMetadata & {
  kind: "set_title";
  value: string;
};

export type SetStatusOperation = OperationMetadata & {
  kind: "set_status";
  value: IncidentStatus;
};

export type SetSeverityOperation = OperationMetadata & {
  kind: "set_severity";
  value: IncidentSeverity;
};

export type Operation =
  | SetTitleOperation
  | SetStatusOperation
  | SetSeverityOperation;
