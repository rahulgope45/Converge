export { applyOperation } from "./apply-operation.js";
export { compareVersion } from "./compare-version.js";
export { createLocalOperation } from "./create-operation.js";
export { createReplica, projectIncident } from "./replica.js";
export type { LocalChange } from "./create-operation.js";
export type {
  Incident,
  IncidentReplica,
  IncidentSeverity,
  IncidentStatus,
  Operation,
  Register,
  SetSeverityOperation,
  SetStatusOperation,
  SetTitleOperation,
  Version,
} from "./model.js";
