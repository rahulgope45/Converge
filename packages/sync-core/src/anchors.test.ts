import { describe, expect, it } from "vitest";

import { anchorAt, indexOfAnchor } from "./anchors.js";
import { applyAll, deleteAt, edit, emptyReplica, insertAt } from "./test-helpers.js";

const base = edit(emptyReplica(), "a", { text: "hello" }).replica;

describe("anchors", () => {
  it("round-trips every caret position", () => {
    for (let index = 0; index <= 5; index += 1) {
      expect(indexOfAnchor(base, anchorAt(base, index))).toBe(index);
    }
  });

  it("uses null for the start of the text", () => {
    expect(anchorAt(base, 0)).toBeNull();
    expect(indexOfAnchor(base, null)).toBe(0);
  });

  it("clamps an index beyond the end", () => {
    expect(anchorAt(base, 99)).toEqual(anchorAt(base, 5));
  });

  it("moves with the character when text is inserted before it", () => {
    const anchor = anchorAt(base, 3);
    const remote = insertAt(base, "b", 1, "XYZ");

    expect(indexOfAnchor(applyAll(base, remote.operations), anchor)).toBe(6);
  });

  it("stays put when text is inserted after it", () => {
    const anchor = anchorAt(base, 2);
    const remote = insertAt(base, "b", 4, "XYZ");

    expect(indexOfAnchor(applyAll(base, remote.operations), anchor)).toBe(2);
  });

  it("falls back to the previous visible character when its own is deleted", () => {
    const anchor = anchorAt(base, 3);
    const remote = deleteAt(base, "b", 1, 2);

    expect(indexOfAnchor(applyAll(base, remote.operations), anchor)).toBe(1);
  });

  it("reports an unknown character as undefined", () => {
    expect(indexOfAnchor(base, { logicalTime: 99, actorId: "z" })).toBeUndefined();
  });

  it("counts an emoji as one position", () => {
    const withEmoji = edit(emptyReplica(), "a", { text: "a😀b" }).replica;

    expect(indexOfAnchor(withEmoji, anchorAt(withEmoji, 2))).toBe(2);
  });
});
