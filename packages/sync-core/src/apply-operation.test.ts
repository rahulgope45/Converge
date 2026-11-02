import { describe, expect, it } from "vitest";

import { applyOperation } from "./apply-operation.js";
import type {
  Incident,
  SetSeverityOperation,
  SetStatusOperation,
  SetTitleOperation,
} from "./model.js";
import { createReplica, projectIncident } from "./replica.js";

const incident: Incident = {
  id: "incident-1",
  title: "Database issue",
  status: "investigating",
  severity: "SEV2",
};

describe("applyOperation", () => {
  it("applies an operation without mutating the original replica", () => {
    const replica = createReplica(incident);
    const operation: SetTitleOperation = {
      operationId: "operation-1",
      documentId: incident.id,
      actorId: "actor-a",
      logicalTime: 1,
      kind: "set_title",
      value: "Production database outage",
    };

    const result = applyOperation(replica, operation);

    expect(projectIncident(result).title).toBe("Production database outage");
    expect(projectIncident(replica).title).toBe("Database issue");
    expect(result).not.toBe(replica);
  });

  it("converges despite reordering, duplicates, and concurrent field edits", () => {
    const statusOperation: SetStatusOperation = {
      operationId: "operation-status",
      documentId: incident.id,
      actorId: "actor-a",
      logicalTime: 1,
      kind: "set_status",
      value: "resolved",
    };
    const severityOperation: SetSeverityOperation = {
      operationId: "operation-severity",
      documentId: incident.id,
      actorId: "actor-b",
      logicalTime: 1,
      kind: "set_severity",
      value: "SEV1",
    };
    const earlierTitle: SetTitleOperation = {
      operationId: "operation-title-a",
      documentId: incident.id,
      actorId: "actor-a",
      logicalTime: 2,
      kind: "set_title",
      value: "Earlier title",
    };
    const winningTitle: SetTitleOperation = {
      operationId: "operation-title-b",
      documentId: incident.id,
      actorId: "actor-b",
      logicalTime: 2,
      kind: "set_title",
      value: "Deterministic title",
    };

    const operationsA = [
      statusOperation,
      earlierTitle,
      severityOperation,
      winningTitle,
      statusOperation,
    ];
    const operationsB = [
      winningTitle,
      severityOperation,
      statusOperation,
      earlierTitle,
      winningTitle,
    ];

    const replicaA = operationsA.reduce(applyOperation, createReplica(incident));
    const replicaB = operationsB.reduce(applyOperation, createReplica(incident));

    expect(projectIncident(replicaA)).toEqual(projectIncident(replicaB));
    expect(projectIncident(replicaA)).toEqual({
      id: incident.id,
      title: "Deterministic title",
      status: "resolved",
      severity: "SEV1",
    });
  });
});
