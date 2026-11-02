import type { Incident, IncidentReplica, Version } from "./model.js";

const initialVersion: Version = {
  logicalTime: 0,
  actorId: "",
};

export function createReplica(incident: Incident): IncidentReplica {
  return {
    documentId: incident.id,
    title: { value: incident.title, version: initialVersion },
    status: { value: incident.status, version: initialVersion },
    severity: { value: incident.severity, version: initialVersion },
    localClock: 0,
    lastServerSequence: 0,
    appliedOperationIds: [],
  };
}

export function projectIncident(replica: IncidentReplica): Incident {
  return {
    id: replica.documentId,
    title: replica.title.value,
    status: replica.status.value,
    severity: replica.severity.value,
  };
}
