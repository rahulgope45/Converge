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

export async function submitOperation(
  operation: Operation,
): Promise<OperationAcknowledgement> {
  const response = await fetch(
    `${apiURL}/api/v1/documents/${operation.documentId}/operations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not submit operation");
  }
  return body as OperationAcknowledgement;
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
