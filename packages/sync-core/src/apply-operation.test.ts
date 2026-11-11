import { describe, expect, it } from "vitest";

import { applyOperation } from "./apply-operation.js";
import type { Operation, SetTextOperation } from "./model.js";
import { createReplica, projectDocument } from "./replica.js";

const replica = createReplica({ id: "doc-1", text: "" });

function op(
  operationId: string,
  actorId: string,
  logicalTime: number,
  value: string,
): SetTextOperation {
  return {
    operationId,
    documentId: "doc-1",
    actorId,
    logicalTime,
    kind: "set_text",
    value,
  };
}

describe("applyOperation", () => {
  it("applies an operation without mutating the original replica", () => {
    const result = applyOperation(replica, op("op-1", "actor-a", 1, "hello"));

    expect(projectDocument(result).text).toBe("hello");
    expect(projectDocument(replica).text).toBe("");
    expect(result).not.toBe(replica);
  });

  it("converges despite reordering, duplicates, and a concurrent tie", () => {
    const early = op("op-early", "actor-a", 1, "first");
    const loser = op("op-a", "actor-a", 2, "from a");
    const winner = op("op-b", "actor-b", 2, "from b");

    const a = [early, loser, winner, early].reduce(applyOperation, replica);
    const b = [winner, early, loser, winner].reduce(applyOperation, replica);

    expect(projectDocument(a)).toEqual(projectDocument(b));
    expect(projectDocument(a)).toEqual({ id: "doc-1", text: "from b" });
  });

  it("accepts empty text as a value", () => {
    const filled = applyOperation(replica, op("op-1", "actor-a", 1, "x"));
    const cleared = applyOperation(filled, op("op-2", "actor-a", 2, ""));

    expect(projectDocument(cleared).text).toBe("");
  });

  it("skips operations of an unknown kind without throwing", () => {
    const legacy = {
      operationId: "op-old",
      documentId: "doc-1",
      actorId: "actor-a",
      logicalTime: 7,
      kind: "set_title",
      value: "Old",
    } as unknown as Operation;

    const result = applyOperation(replica, legacy);

    expect(projectDocument(result).text).toBe("");
    expect(result.localClock).toBe(7);
    expect(result.appliedOperationIds).toContain("op-old");
  });

  it("rejects an operation for another document", () => {
    const foreign = { ...op("op-1", "actor-a", 1, "x"), documentId: "doc-2" };

    expect(() => applyOperation(replica, foreign)).toThrow();
  });
});
