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