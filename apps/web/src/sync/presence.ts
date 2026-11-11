import type { CharId } from "@converge/sync-core";

import type { StoredOperation } from "./api-client.js";

// A participant's caret. `anchor` is the character in front of the caret,
// null for the start of the text, and undefined when they have no caret.
export type Peer = {
  actorId: string;
  name: string;
  color: string;
  anchor: CharId | null | undefined;
};

export type ServerFrame =
  | { kind: "operation"; stored: StoredOperation }
  | { kind: "presence"; peer: Peer }
  | { kind: "leave"; actorId: string };

export const PALETTE = [
  "#d1495b",
  "#00798c",
  "#edae49",
  "#66a182",
  "#8d5a97",
  "#2e4057",
  "#e07a5f",
  "#3a86ff",
] as const;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function identityFor(actorId: string): { name: string; color: string } {
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) {
    hash = (hash * 31 + actorId.charCodeAt(index)) >>> 0;
  }
  return {
    name: `Guest ${actorId.slice(0, 4)}`,
    color: PALETTE[hash % PALETTE.length]!,
  };
}

export function presenceFrame(
  actorId: string,
  anchor: CharId | null | undefined,
): string {
  return JSON.stringify({
    type: "presence",
    actorId,
    ...identityFor(actorId),
    ...(anchor === undefined ? {} : { anchor }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAnchor(value: unknown): CharId | null | undefined | "invalid" {
  if (value === undefined || value === null) {
    return value;
  }
  if (
    isRecord(value) &&
    typeof value.logicalTime === "number" &&
    typeof value.actorId === "string"
  ) {
    return { logicalTime: value.logicalTime, actorId: value.actorId };
  }
  return "invalid";
}

// Classifies a WebSocket frame from the server. Stored operations have no
// `type` field; presence frames do. Anything unrecognised is undefined.
export function parseServerFrame(data: string): ServerFrame | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(frame)) {
    return undefined;
  }

  if (frame.type === undefined) {
    return typeof frame.serverSequence === "number" && isRecord(frame.operation)
      ? { kind: "operation", stored: frame as unknown as StoredOperation }
      : undefined;
  }

  if (typeof frame.actorId !== "string" || frame.actorId === "") {
    return undefined;
  }

  if (frame.type === "presence_leave") {
    return { kind: "leave", actorId: frame.actorId };
  }

  if (frame.type === "presence") {
    const anchor = parseAnchor(frame.anchor);
    if (
      typeof frame.name !== "string" ||
      typeof frame.color !== "string" ||
      !COLOR_PATTERN.test(frame.color) ||
      anchor === "invalid"
    ) {
      return undefined;
    }
    return {
      kind: "presence",
      peer: { actorId: frame.actorId, name: frame.name, color: frame.color, anchor },
    };
  }

  return undefined;
}
