import type { CharId, DocumentReplica } from "./model.js";

// An anchor pins a caret to the character in front of it, so the caret keeps
// its place when other replicas insert or delete text elsewhere.
// Indices are in code points of the visible text. `null` is the start.

export function anchorAt(replica: DocumentReplica, index: number): CharId | null {
  if (index <= 0) {
    return null;
  }

  let seen = 0;
  let last: CharId | null = null;
  for (const element of replica.elements) {
    if (element.deleted) {
      continue;
    }
    seen += 1;
    last = element.id;
    if (seen === index) {
      break;
    }
  }
  return last;
}

// Returns the index just after the anchored character. If that character has
// been deleted, the index just after the nearest visible character before
// it. Returns undefined when the character has not been received yet.
export function indexOfAnchor(
  replica: DocumentReplica,
  anchor: CharId | null,
): number | undefined {
  if (anchor === null) {
    return 0;
  }

  let visible = 0;
  for (const element of replica.elements) {
    if (!element.deleted) {
      visible += 1;
    }
    if (
      element.id.logicalTime === anchor.logicalTime &&
      element.id.actorId === anchor.actorId
    ) {
      return visible;
    }
  }
  return undefined;
}
