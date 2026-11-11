export type TextChange = {
  // Index in the old text where the change starts.
  start: number;
  // Number of old code points removed from `start`.
  removed: number;
  // Code points inserted at `start`.
  inserted: string[];
};

function commonPrefix(
  before: readonly string[],
  after: readonly string[],
  limit: number,
): number {
  let length = 0;
  while (length < limit && before[length] === after[length]) {
    length += 1;
  }
  return length;
}

function commonSuffix(
  before: readonly string[],
  after: readonly string[],
  limit: number,
): number {
  let length = 0;
  while (
    length < limit &&
    before[before.length - 1 - length] === after[after.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

// Finds the single contiguous change that turns `before` into `after`.
//
// Without a caret the change is whatever lies between the longest common
// prefix and suffix. That is ambiguous inside repeated text, so when the
// caret position after the change is known, the text behind the caret is
// taken as the unchanged suffix: the edit ended exactly at the caret.
export function diffText(
  before: readonly string[],
  after: readonly string[],
  caret?: number,
): TextChange {
  const shorter = Math.min(before.length, after.length);
  let suffix: number | undefined;

  if (caret !== undefined && caret >= 0 && caret <= after.length) {
    const tail = after.length - caret;
    if (tail <= before.length && commonSuffix(before, after, tail) === tail) {
      suffix = tail;
    }
  }

  let prefix: number;
  if (suffix === undefined) {
    prefix = commonPrefix(before, after, shorter);
    suffix = commonSuffix(before, after, shorter - prefix);
  } else {
    prefix = commonPrefix(before, after, shorter - suffix);
  }

  return {
    start: prefix,
    removed: before.length - suffix - prefix,
    inserted: after.slice(prefix, after.length - suffix),
  };
}
