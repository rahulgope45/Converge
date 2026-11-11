import { describe, expect, it } from "vitest";

import { nextDraft, sanitizeText } from "./draft.js";

describe("nextDraft", () => {
  it("keeps newer keystrokes when the editor's own commit echoes back", () => {
    expect(
      nextDraft({
        draft: "hello wor",
        lastCommitted: "hello",
        incoming: "hello",
        queuedLocalChanges: 0,
      }),
    ).toBe("hello wor");
  });

  it("takes a remote text that differs from the last commit", () => {
    expect(
      nextDraft({
        draft: "hello wor",
        lastCommitted: "hello",
        incoming: "bye",
        queuedLocalChanges: 0,
      }),
    ).toBe("bye");
  });

  it("takes the incoming text when nothing was typed", () => {
    expect(
      nextDraft({
        draft: "",
        lastCommitted: "",
        incoming: "loaded",
        queuedLocalChanges: 0,
      }),
    ).toBe("loaded");
  });

  it("keeps the draft while an earlier commit of this editor is still queued", () => {
    // Commits "ab" and "abc" overlap: "ab" echoes back after "abc" was sent
    // and "abcd" was typed. It must not roll the box back to "ab".
    expect(
      nextDraft({
        draft: "abcd",
        lastCommitted: "abc",
        incoming: "ab",
        queuedLocalChanges: 1,
      }),
    ).toBe("abcd");
  });

  it("keeps the draft when a remote text lands before a queued commit", () => {
    expect(
      nextDraft({
        draft: "mine",
        lastCommitted: "mine",
        incoming: "theirs",
        queuedLocalChanges: 1,
      }),
    ).toBe("mine");
  });
});

describe("sanitizeText", () => {
  it("leaves ordinary text, newlines and emoji unchanged", () => {
    expect(sanitizeText("line one\nline two 😀")).toBe("line one\nline two 😀");
  });

  it("removes NUL characters, which the database cannot store", () => {
    expect(sanitizeText("a\u0000b")).toBe("ab");
  });

  it("replaces half of a split emoji with the replacement character", () => {
    expect(sanitizeText("cut \ud83d")).toBe("cut �");
    expect(sanitizeText("\ude00 cut")).toBe("� cut");
  });
});
