type DraftInput = {
  draft: string;
  lastCommitted: string;
  incoming: string;
  queuedLocalChanges: number;
};

// Decides what the text box shows when the synchronized text changes.
//
// While this editor still has commits queued, whatever arrives is about to be
// superseded by them, so the draft stays. Once the queue is empty, text equal
// to the editor's last commit is its own echo and keystrokes typed since then
// are kept. Any other text is a remote change and wins.
export function nextDraft({
  draft,
  lastCommitted,
  incoming,
  queuedLocalChanges,
}: DraftInput): string {
  if (queuedLocalChanges > 0 || incoming === lastCommitted) {
    return draft;
  }
  return incoming;
}

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The database cannot store NUL characters or half of a surrogate pair (which
// a length limit can leave behind when it cuts an emoji in two). Sending either
// would be rejected on every retry and block all later changes.
export function sanitizeText(text: string): string {
  return text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "�");
}
