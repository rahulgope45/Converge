import type { Operation } from "@converge/sync-core";
import { describe, expect, it } from "vitest";

import { RejectedError, isRejection, sendBatch, takeBatch } from "./outbox.js";

function insert(index: number, text = "x"): Operation {
  return {
    operationId: `op-${index}`,
    documentId: "doc-1",
    actorId: "a",
    logicalTime: index,
    kind: "insert_text",
    value: { after: null, text },
  };
}

function bodySize(operations: readonly Operation[]): number {
  return new TextEncoder().encode(JSON.stringify({ operations })).length;
}

describe("takeBatch", () => {
  it("takes at most the count limit, from the front", () => {
    const pending = [insert(1), insert(2), insert(3)];
    expect(takeBatch(pending, 2, 1_000_000)).toEqual([insert(1), insert(2)]);
  });

  it("stops before the encoded request would exceed the byte limit", () => {
    // Three bytes per character in UTF-8.
    const pending = [1, 2, 3, 4].map((index) => insert(index, "\u6f22".repeat(1000)));
    const limit = bodySize(pending.slice(0, 2)) + 10;

    const batch = takeBatch(pending, 100, limit);

    expect(batch).toEqual(pending.slice(0, 2));
    expect(bodySize(batch)).toBeLessThanOrEqual(limit);
  });

  it("sends an operation larger than the byte limit on its own", () => {
    const pending = [insert(1, "x".repeat(5000)), insert(2)];
    expect(takeBatch(pending, 100, 100)).toEqual([pending[0]]);
  });
});

describe("isRejection", () => {
  it("is true only for responses that retrying cannot change", () => {
    expect([400, 409, 413, 422].map(isRejection)).toEqual([true, true, true, true]);
    expect([404, 408, 429, 500, 503].map(isRejection)).toEqual([false, false, false, false, false]);
  });
});

describe("sendBatch", () => {
  // A server that refuses any request containing one of the bad operations.
  function server(bad: readonly string[]) {
    const stored: string[] = [];
    const submit = async (operations: readonly Operation[]) => {
      if (operations.some((operation) => bad.includes(operation.operationId))) {
        throw new RejectedError(400, "refused");
      }
      stored.push(...operations.map((operation) => operation.operationId));
    };
    return { stored, submit };
  }

  it("delivers the whole batch when the server accepts it", async () => {
    const { stored, submit } = server([]);
    const batch = [insert(1), insert(2), insert(3)];

    expect(await sendBatch(batch, submit)).toEqual([]);
    expect(stored).toEqual(["op-1", "op-2", "op-3"]);
  });

  it("isolates refused operations and still delivers the rest in order", async () => {
    const { stored, submit } = server(["op-2", "op-5"]);
    const batch = [1, 2, 3, 4, 5, 6, 7].map((index) => insert(index));

    const rejected = await sendBatch(batch, submit);

    expect(rejected.map((operation) => operation.operationId)).toEqual(["op-2", "op-5"]);
    expect(stored).toEqual(["op-1", "op-3", "op-4", "op-6", "op-7"]);
  });

  it("lets failures that may be temporary propagate", async () => {
    const submit = async () => {
      throw new Error("network down");
    };
    await expect(sendBatch([insert(1), insert(2)], submit)).rejects.toThrow("network down");
  });
});
