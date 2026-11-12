// The DOM reports caret positions in UTF-16 code units, while the sync core
// counts whole Unicode code points. These helpers convert between the two.

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function pairStartsAt(text: string, offset: number): boolean {
  return (
    isHighSurrogate(text.charCodeAt(offset)) &&
    isLowSurrogate(text.charCodeAt(offset + 1))
  );
}

// An offset that falls inside a surrogate pair counts as the pair's start.
export function toCodePointIndex(text: string, utf16Offset: number): number {
  const limit = Math.max(0, Math.min(utf16Offset, text.length));
  let index = 0;
  let offset = 0;
  while (offset < limit) {
    const width = pairStartsAt(text, offset) ? 2 : 1;
    if (offset + width > limit) {
      break;
    }
    offset += width;
    index += 1;
  }
  return index;
}

export function toUtf16Offset(text: string, codePointIndex: number): number {
  let offset = 0;
  for (let index = 0; index < codePointIndex && offset < text.length; index += 1) {
    offset += pairStartsAt(text, offset) ? 2 : 1;
  }
  return offset;
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The database cannot store NUL characters or half of a surrogate pair (which
// a length limit can leave behind when it cuts an emoji in two). Sending either
// would be rejected on every retry and block all later changes.
export function sanitizeText(text: string): string {
  return text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "�");
}
