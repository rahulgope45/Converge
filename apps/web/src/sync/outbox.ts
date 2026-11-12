import type { Operation } from "@converge/sync-core";

// The server refused a request in a way that sending it again cannot change.
export class RejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RejectedError";
  }
}

// Invalid, conflicting or oversized requests. Everything else, including
// "room not found" and server faults, may succeed later and is retried.
export function isRejection(status: number): boolean {
  return status === 400 || status === 409 || status === 413 || status === 422;
}

const encoder = new TextEncoder();
const ENVELOPE_BYTES = encoder.encode(JSON.stringify({ operations: [] })).length;

// Takes operations from the front of `pending` until either limit would be
// passed. The first operation is always taken, so a single oversized one
// is sent alone rather than blocking the queue unseen.
export function takeBatch(
  pending: readonly Operation[],
  maxCount: number,
  maxBytes: number,
): Operation[] {
  const batch: Operation[] = [];
  let bytes = ENVELOPE_BYTES;

  for (const operation of pending) {
    // One more for the comma between array items.
    const size = encoder.encode(JSON.stringify(operation)).length + 1;
    if (batch.length > 0 && (batch.length === maxCount || bytes + size > maxBytes)) {
      break;
    }
    batch.push(operation);
    bytes += size;
  }
  return batch;
}

// Submits a batch and returns the operations the server refused for good.
// The server accepts or refuses a request as a whole, so a refused batch is
// halved until the refused operations stand alone; the rest are delivered
// in their original order. Other failures propagate to the caller.
export async function sendBatch(
  batch: readonly Operation[],
  submit: (operations: readonly Operation[]) => Promise<unknown>,
): Promise<Operation[]> {
  try {
    await submit(batch);
    return [];
  } catch (error) {
    if (!(error instanceof RejectedError)) {
      throw error;
    }
    if (batch.length === 1) {
      return [...batch];
    }
  }

  const middle = Math.ceil(batch.length / 2);
  const first = await sendBatch(batch.slice(0, middle), submit);
  const second = await sendBatch(batch.slice(middle), submit);
  return [...first, ...second];
}
