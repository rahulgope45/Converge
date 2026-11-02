import type { Version } from "./model.js";

export function compareVersion(left: Version, right: Version): number {
  if (left.logicalTime !== right.logicalTime) {
    return left.logicalTime > right.logicalTime ? 1 : -1;
  }

  if (left.actorId === right.actorId) {
    return 0;
  }

  return left.actorId > right.actorId ? 1 : -1;
}
