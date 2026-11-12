import { describe, expect, it } from "vitest";

import { MAX_DELETE_LENGTH, MAX_DELETE_SPANS } from "./create-operation.js";
import type { DeleteTextOperation, Operation } from "./model.js";
import { textOf } from "./replica.js";
import { applyAll, edit, emptyReplica, insertAt } from "./test-helpers.js";

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

function deletesOf(operations: readonly Operation[]): DeleteTextOperation[] {
  return operations.filter(
    (operation): operation is DeleteTextOperation => operation.kind === "delete_text",
  );
}

describe("createLocalOperations limits", () => {
  it("splits a delete so no operation exceeds the server's span limit", () => {
    // Two people typing alternately: every character is its own span.
    let replica = emptyReplica();
    const history: Operation[] = [];
    for (let index = 0; index < 2 * MAX_DELETE_SPANS + 200; index += 1) {
      const step = insertAt(replica, index % 2 === 0 ? "a" : "b", index, "x");
      replica = step.replica;
      history.push(...step.operations);
    }

    const cleared = edit(replica, "a", { text: "" });
    const deletes = deletesOf(cleared.operations);

    expect(deletes).toHaveLength(3);
    for (const operation of deletes) {
      expect(operation.value.spans.length).toBeLessThanOrEqual(MAX_DELETE_SPANS);
    }
    expect(new Set(cleared.operations.map((o) => o.logicalTime)).size).toBe(3);
    expect(textOf(cleared.replica)).toBe("");
    expect(textOf(applyAll(applyAll(emptyReplica(), history), cleared.operations))).toBe("");
  });

  it("splits a delete so no operation removes more than the length limit", () => {
    // One person's consecutive inserts form a single span longer than the limit.
    let replica = emptyReplica();
    for (let round = 0; round < 3; round += 1) {
      replica = insertAt(replica, "a", Number.MAX_SAFE_INTEGER, "x".repeat(MAX_DELETE_LENGTH - 1)).replica;
    }

    const cleared = edit(replica, "a", { text: "keep" });
    const deletes = deletesOf(cleared.operations);

    expect(deletes).toHaveLength(3);
    for (const operation of deletes) {
      const total = operation.value.spans.reduce((sum, span) => sum + span.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_DELETE_LENGTH);
    }
    expect(cleared.operations.at(-1)).toMatchObject({ kind: "insert_text" });
    expect(textOf(cleared.replica)).toBe("keep");
  });
});
