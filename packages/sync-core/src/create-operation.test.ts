import { describe, expect, it } from "vitest";

import { textOf } from "./replica.js";
import { edit, emptyReplica } from "./test-helpers.js";

function replicaWith(text: string) {
  return edit(emptyReplica(), "a", { text }).replica;
}

describe("createLocalOperations", () => {
  it("returns nothing when the text is unchanged", () => {
    expect(edit(replicaWith("same"), "a", { text: "same" }).operations).toEqual([]);
  });

  it("creates one insert for typed text", () => {
    const { replica, operations } = edit(replicaWith("helo"), "a", {
      text: "hello",
      caret: 4,
    });

    expect(operations.map((operation) => operation.kind)).toEqual(["insert_text"]);
    expect(textOf(replica)).toBe("hello");
  });

  it("uses the caret to place an insert inside repeated text", () => {
    const base = replicaWith("aaa");
    const second = base.elements[1]!.id;

    const { operations } = edit(base, "b", { text: "aaaa", caret: 3 });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "insert_text",
      value: { after: second, text: "a" },
    });
  });

  it("uses the caret to pick which repeated character was deleted", () => {
    const base = replicaWith("aaa");
    const second = base.elements[1]!.id;

    const { operations } = edit(base, "b", { text: "aa", caret: 1 });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "delete_text",
      value: {
        spans: [{ actorId: second.actorId, from: second.logicalTime, length: 1 }],
      },
    });
  });

  it("replaces a selection with a delete followed by an insert", () => {
    const { replica, operations } = edit(replicaWith("hello world"), "b", {
      text: "hello there",
      caret: 11,
    });

    expect(operations.map((operation) => operation.kind)).toEqual([
      "delete_text",
      "insert_text",
    ]);
    expect(operations[1]!.logicalTime).toBe(operations[0]!.logicalTime + 1);
    expect(textOf(replica)).toBe("hello there");
  });

  it("groups deleted characters from different authors into separate spans", () => {
    const base = edit(replicaWith("ab"), "b", { text: "abcd", caret: 4 }).replica;

    const { operations } = edit(base, "c", { text: "", caret: 0 });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "delete_text",
      value: {
        spans: [
          { actorId: "a", from: 1, length: 2 },
          { actorId: "b", from: 3, length: 2 },
        ],
      },
    });
  });

  it("works without a caret", () => {
    const { replica } = edit(replicaWith("one two"), "a", { text: "one 2 two" });

    expect(textOf(replica)).toBe("one 2 two");
  });

  it("ignores a caret that does not fit the change", () => {
    const { replica } = edit(replicaWith("abc"), "a", { text: "xbc", caret: 3 });

    expect(textOf(replica)).toBe("xbc");
  });

  it("treats an emoji as a single character", () => {
    const { replica, operations } = edit(replicaWith("a😀b"), "a", {
      text: "ab",
      caret: 1,
    });

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      value: { spans: [{ actorId: "a", from: 2, length: 1 }] },
    });
    expect(textOf(replica)).toBe("ab");
  });

  it("starts each local operation one tick after the replica clock", () => {
    const base = replicaWith("hello");

    const { operations, replica } = edit(base, "a", { text: "hello!!", caret: 7 });

    expect(operations[0]!.logicalTime).toBe(base.localClock + 1);
    expect(replica.localClock).toBe(base.localClock + 2);
  });
});
