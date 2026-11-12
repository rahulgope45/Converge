import { describe, expect, it } from "vitest";

import { sanitizeText, toCodePointIndex, toUtf16Offset } from "./text-offsets.js";

// "a😀b": UTF-16 units a(0) 😀(1,2) b(3); code points a(0) 😀(1) b(2).
const text = "a😀b";

describe("toCodePointIndex", () => {
  it("maps offsets around an emoji", () => {
    expect(toCodePointIndex(text, 0)).toBe(0);
    expect(toCodePointIndex(text, 1)).toBe(1);
    expect(toCodePointIndex(text, 3)).toBe(2);
    expect(toCodePointIndex(text, 4)).toBe(3);
  });

  it("rounds an offset inside a surrogate pair down to its start", () => {
    expect(toCodePointIndex(text, 2)).toBe(1);
  });

  it("clamps offsets outside the text", () => {
    expect(toCodePointIndex(text, -5)).toBe(0);
    expect(toCodePointIndex(text, 99)).toBe(3);
  });
});

describe("toUtf16Offset", () => {
  it("maps indices around an emoji", () => {
    expect(toUtf16Offset(text, 0)).toBe(0);
    expect(toUtf16Offset(text, 1)).toBe(1);
    expect(toUtf16Offset(text, 2)).toBe(3);
    expect(toUtf16Offset(text, 3)).toBe(4);
  });

  it("clamps indices outside the text", () => {
    expect(toUtf16Offset(text, -1)).toBe(0);
    expect(toUtf16Offset(text, 99)).toBe(4);
  });

  it("round-trips every code point boundary", () => {
    const sample = "x𝒳y👍🏽z";
    const points = Array.from(sample).length;
    for (let index = 0; index <= points; index += 1) {
      expect(toCodePointIndex(sample, toUtf16Offset(sample, index))).toBe(index);
    }
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
