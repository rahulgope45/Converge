import { describe, expect, it } from "vitest";

import { applyOperation } from "./apply-operation.js";
import type {
  DeleteTextOperation,
  InsertTextOperation,
  Operation,
} from "./model.js";
import { textOf } from "./replica.js";
import { applyAll, DOCUMENT_ID, emptyReplica } from "./test-helpers.js";

function insert(
  operationId: string,
  actorId: string,
  logicalTime: number,
  after: InsertTextOperation["value"]["after"],
  text: string,
): InsertTextOperation {
  return {
    operationId,
    documentId: DOCUMENT_ID,
    actorId,
    logicalTime,
    kind: "insert_text",
    value: { after, text },
  };
}

function remove(
  operationId: string,
  actorId: string,
  logicalTime: number,
  spans: DeleteTextOperation["value"]["spans"],
): DeleteTextOperation {
  return {
    operationId,
    documentId: DOCUMENT_ID,
    actorId,
    logicalTime,
    kind: "delete_text",
    value: { spans },
  };
}

const hello = insert("op-hello", "a", 1, null, "hello");

describe("applyOperation: insert", () => {
  it("inserts a run at the start without mutating the original replica", () => {
    const replica = emptyReplica();
    const result = applyOperation(replica, hello);

    expect(textOf(result)).toBe("hello");
    expect(textOf(replica)).toBe("");
    expect(result.localClock).toBe(5);
  });

  it("inserts after a given character", () => {
    const middle = insert("op-mid", "a", 6, { logicalTime: 2, actorId: "a" }, "XY");

    expect(textOf(applyAll(emptyReplica(), [hello, middle]))).toBe("heXYllo");
  });

  it("ignores an insert it has already applied", () => {
    expect(textOf(applyAll(emptyReplica(), [hello, hello]))).toBe("hello");
  });

  it("orders concurrent inserts at one position by id, on every replica", () => {
    const fromA = insert("op-a", "a", 6, { logicalTime: 5, actorId: "a" }, "AA");
    const fromB = insert("op-b", "b", 6, { logicalTime: 5, actorId: "a" }, "BB");

    const first = textOf(applyAll(emptyReplica(), [hello, fromA, fromB]));
    const second = textOf(applyAll(emptyReplica(), [hello, fromB, fromA]));

    expect(first).toBe("helloBBAA");
    expect(second).toBe(first);
  });

  it("stores one emoji as one element", () => {
    const result = applyOperation(emptyReplica(), insert("op-e", "a", 1, null, "a😀b"));

    expect(result.elements).toHaveLength(3);
    expect(result.localClock).toBe(3);
  });
});

describe("applyOperation: delete", () => {
  it("hides the named characters and keeps them as tombstones", () => {
    const result = applyAll(emptyReplica(), [
      hello,
      remove("op-del", "a", 6, [{ actorId: "a", from: 2, length: 3 }]),
    ]);

    expect(textOf(result)).toBe("ho");
    expect(result.elements).toHaveLength(5);
    expect(result.localClock).toBe(6);
  });

  it("treats a repeated delete as a no-op", () => {
    const del = remove("op-del", "a", 6, [{ actorId: "a", from: 1, length: 1 }]);

    expect(textOf(applyAll(emptyReplica(), [hello, del, del]))).toBe("ello");
  });

  it("still places an insert after a character that was deleted", () => {
    const result = applyAll(emptyReplica(), [
      hello,
      remove("op-del", "b", 6, [{ actorId: "a", from: 3, length: 1 }]),
      insert("op-ins", "c", 6, { logicalTime: 3, actorId: "a" }, "X"),
    ]);

    expect(textOf(result)).toBe("heXlo");
  });
});

describe("applyOperation: delivery order", () => {
  it("holds an insert until the character it follows arrives", () => {
    const child = insert("op-child", "b", 6, { logicalTime: 5, actorId: "a" }, "!");

    const waiting = applyOperation(emptyReplica(), child);
    expect(textOf(waiting)).toBe("");
    expect(waiting.orphans).toHaveLength(1);

    const done = applyOperation(waiting, hello);
    expect(textOf(done)).toBe("hello!");
    expect(done.orphans).toHaveLength(0);
  });

  it("holds a delete until the characters it names arrive", () => {
    const del = remove("op-del", "b", 6, [{ actorId: "a", from: 1, length: 2 }]);

    const done = applyAll(emptyReplica(), [del, del, hello]);

    expect(textOf(done)).toBe("llo");
    expect(done.orphans).toHaveLength(0);
  });

  it("resolves a chain of held operations in one pass", () => {
    const second = insert("op-2", "b", 6, { logicalTime: 5, actorId: "a" }, "1");
    const third = insert("op-3", "c", 7, { logicalTime: 6, actorId: "b" }, "2");

    expect(textOf(applyAll(emptyReplica(), [third, second, hello]))).toBe("hello12");
  });
});

describe("applyOperation: other cases", () => {
  it("only raises the clock for kinds from earlier versions", () => {
    const legacy = {
      operationId: "op-old",
      documentId: DOCUMENT_ID,
      actorId: "a",
      logicalTime: 9,
      kind: "set_text",
      value: "Old",
    } as unknown as Operation;

    const result = applyOperation(emptyReplica(), legacy);

    expect(textOf(result)).toBe("");
    expect(result.localClock).toBe(9);
    expect(result.orphans).toHaveLength(0);
  });

  it("rejects an operation for another document", () => {
    expect(() =>
      applyOperation(emptyReplica(), { ...hello, documentId: "doc-2" }),
    ).toThrow();
  });
});
