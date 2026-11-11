import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyOperation } from "./apply-operation.js";
import type { DocumentReplica, Operation } from "./model.js";
import { textOf } from "./replica.js";
import {
  applyAll,
  deleteAt,
  edit,
  emptyReplica,
  insertAt,
} from "./test-helpers.js";

const RUNS = { numRuns: 300 };
const ACTORS = ["actor-a", "actor-b", "actor-c"];

type Step =
  | { type: "insert"; replica: number; position: number; text: string }
  | { type: "delete"; replica: number; position: number; length: number }
  | { type: "deliver"; operation: number; replica: number };

const text = fc.string({ unit: "grapheme", minLength: 1, maxLength: 4 });
const replicaIndex = fc.integer({ min: 0, max: ACTORS.length - 1 });

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    type: fc.constant("insert" as const),
    replica: replicaIndex,
    position: fc.nat(40),
    text,
  }),
  fc.record({
    type: fc.constant("delete" as const),
    replica: replicaIndex,
    position: fc.nat(40),
    length: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    type: fc.constant("deliver" as const),
    operation: fc.nat(200),
    replica: replicaIndex,
  }),
);

const script = fc.array(step, { minLength: 1, maxLength: 60 });

// Runs a script of local edits and arbitrary partial deliveries. Returns the
// replicas as they stand (not yet fully synchronized) and every operation
// created, in creation order.
function run(steps: readonly Step[]): {
  replicas: DocumentReplica[];
  operations: Operation[];
} {
  const replicas = ACTORS.map(() => emptyReplica());
  const operations: Operation[] = [];

  for (const current of steps) {
    if (current.type === "deliver") {
      if (operations.length > 0) {
        const operation = operations[current.operation % operations.length]!;
        replicas[current.replica] = applyOperation(
          replicas[current.replica]!,
          operation,
        );
      }
      continue;
    }

    const before = replicas[current.replica]!;
    const actor = ACTORS[current.replica]!;
    const result =
      current.type === "insert"
        ? insertAt(before, actor, current.position, current.text)
        : deleteAt(before, actor, current.position, current.length);
    replicas[current.replica] = result.replica;
    operations.push(...result.operations);
  }

  return { replicas, operations };
}

describe("convergence properties", () => {
  it("replicas that receive the same operations show the same text", () => {
    fc.assert(
      fc.property(script, (steps) => {
        const { replicas, operations } = run(steps);

        const synchronized = replicas.map((replica) =>
          applyAll(replica, operations),
        );

        const texts = synchronized.map(textOf);
        expect(texts[1]).toBe(texts[0]);
        expect(texts[2]).toBe(texts[0]);
        for (const replica of synchronized) {
          expect(replica.orphans).toHaveLength(0);
        }
      }),
      RUNS,
    );
  });

  it("delivery order and duplicate delivery do not change the result", () => {
    fc.assert(
      fc.property(
        script,
        fc.array(fc.nat(1000), { maxLength: 400 }),
        fc.array(fc.nat(1000), { maxLength: 30 }),
        (steps, sortKeys, repeats) => {
          const { operations } = run(steps);
          const reference = textOf(applyAll(emptyReplica(), operations));

          const shuffled = operations
            .map((operation, index) => ({
              operation,
              key: sortKeys[index % Math.max(sortKeys.length, 1)] ?? 0,
            }))
            .sort((left, right) => left.key - right.key)
            .map((entry) => entry.operation);
          const duplicates = repeats
            .filter(() => operations.length > 0)
            .map((index) => operations[index % operations.length]!);

          const result = applyAll(emptyReplica(), [
            ...duplicates,
            ...shuffled,
            ...duplicates,
          ]);

          expect(textOf(result)).toBe(reference);
          expect(result.orphans).toHaveLength(0);
        },
      ),
      RUNS,
    );
  });

  it("a local edit produces exactly the text that was typed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: "grapheme", maxLength: 30 }), {
          minLength: 1,
          maxLength: 12,
        }),
        (targets) => {
          let replica = emptyReplica();
          for (const target of targets) {
            replica = edit(replica, "actor-a", { text: target }).replica;
            expect(textOf(replica)).toBe(target);
          }
        },
      ),
      RUNS,
    );
  });

  it("runs typed concurrently at one position are not interleaved", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        (baseLength, position, lengthA, lengthB) => {
          const seeded = edit(emptyReplica(), "actor-c", {
            text: "x".repeat(baseLength),
          });
          const fromA = insertAt(seeded.replica, "actor-a", position, "A".repeat(lengthA));
          const fromB = insertAt(seeded.replica, "actor-b", position, "B".repeat(lengthB));

          const onA = textOf(applyAll(fromA.replica, fromB.operations));
          const onB = textOf(applyAll(fromB.replica, fromA.operations));

          expect(onA).toBe(onB);
          expect(onA).toContain("A".repeat(lengthA));
          expect(onA).toContain("B".repeat(lengthB));
          expect(onA).toHaveLength(baseLength + lengthA + lengthB);
        },
      ),
      RUNS,
    );
  });
});
