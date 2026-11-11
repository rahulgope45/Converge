import { describe, expect, it } from "vitest";

import { identityFor, PALETTE, parseServerFrame } from "./presence.js";

describe("identityFor", () => {
  it("gives the same actor the same name and colour every time", () => {
    const actorId = "4f2a9c1e-0000-4000-8000-000000000000";

    expect(identityFor(actorId)).toEqual(identityFor(actorId));
    expect(identityFor(actorId).name).toBe("Guest 4f2a");
  });

  it("always picks a colour from the palette", () => {
    for (const actorId of ["a", "bb", "4f2a9c1e", "zzzzzzzz", ""]) {
      expect(PALETTE).toContain(identityFor(actorId).color);
    }
  });
});

describe("parseServerFrame", () => {
  it("recognises a stored operation", () => {
    const frame = parseServerFrame(
      JSON.stringify({
        serverSequence: 12,
        operation: {
          operationId: "op-1",
          documentId: "doc-1",
          actorId: "a",
          logicalTime: 1,
          kind: "insert_text",
          value: { after: null, text: "x" },
        },
      }),
    );

    expect(frame).toMatchObject({ kind: "operation", stored: { serverSequence: 12 } });
  });

  it("recognises a presence with a caret", () => {
    const frame = parseServerFrame(
      JSON.stringify({
        type: "presence",
        actorId: "bob",
        name: "Guest b0b0",
        color: "#1f77b4",
        anchor: { logicalTime: 3, actorId: "a" },
      }),
    );

    expect(frame).toEqual({
      kind: "presence",
      peer: {
        actorId: "bob",
        name: "Guest b0b0",
        color: "#1f77b4",
        anchor: { logicalTime: 3, actorId: "a" },
      },
    });
  });

  it("keeps the difference between a caret at the start and no caret", () => {
    const atStart = parseServerFrame(
      '{"type":"presence","actorId":"b","name":"n","color":"#000000","anchor":null}',
    );
    const none = parseServerFrame(
      '{"type":"presence","actorId":"b","name":"n","color":"#000000"}',
    );

    expect(atStart).toMatchObject({ peer: { anchor: null } });
    expect(none).toMatchObject({ peer: { anchor: undefined } });
  });

  it("recognises a leave", () => {
    expect(parseServerFrame('{"type":"presence_leave","actorId":"bob"}')).toEqual({
      kind: "leave",
      actorId: "bob",
    });
  });

  it("returns undefined for anything else", () => {
    expect(parseServerFrame("not json")).toBeUndefined();
    expect(parseServerFrame('{"type":"mystery"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"presence","actorId":"b"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"presence","actorId":"b","name":"n","color":"red"}')).toBeUndefined();
    expect(parseServerFrame('{"serverSequence":"1"}')).toBeUndefined();
    expect(parseServerFrame("null")).toBeUndefined();
  });
});
