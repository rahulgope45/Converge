import type { Operation } from "@converge/sync-core";

export type StoredOperation = {
  serverSequence: number;
  operation: Operation;
};

type OperationsPage = {
  operations: StoredOperation[];
  lastServerSequence: number;
  hasMore: boolean;
};

type OperationAcknowledgement = {
  operationId: string;
  serverSequence: number;
  duplicate: boolean;
};

const apiURL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);
const websocketURL = (
  import.meta.env.VITE_WS_URL ?? "ws://localhost:8080"
).replace(/\/$/, "");

export async function createDocument(): Promise<string> {
  const response = await fetch(`${apiURL}/api/v1/documents`, {
    method: "POST",
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not create room");
  }
  return body.documentId as string;
}

// The server accepts at most this many operations in one batch request.
export const MAX_BATCH_SIZE = 100;

// Sends operations in one request. The server stores them in order and the
// call is safe to repeat: operations it already has come back as duplicates.
export async function submitOperations(
  documentId: string,
  operations: readonly Operation[],
): Promise<OperationAcknowledgement[]> {
  const response = await fetch(
    `${apiURL}/api/v1/documents/${documentId}/operations/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not submit operations");
  }
  return body.results as OperationAcknowledgement[];
}

export async function fetchOperations(
  documentId: string,
  after: number,
): Promise<OperationsPage> {
  const response = await fetch(
    `${apiURL}/api/v1/documents/${documentId}/operations?after=${after}`,
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not fetch operations");
  }
  return body as OperationsPage;
}

export function operationStreamURL(documentId: string): string {
  return `${websocketURL}/api/v1/documents/${documentId}/stream`;
}
