import { isAddress, type Address } from "viem";
import {
  getEtherscanHistory,
  HistoryServiceError,
} from "@/services/etherscan-history";
import type { TransactionHistoryKind } from "@/types/transaction-history";

const MAX_REQUEST_BYTES = 110_000;

class RequestTooLargeError extends Error {}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readRequestBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonError("The history request is too large.", 413);
    }
    return jsonError("Could not read the history request.", 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError("The history request is invalid.", 400);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("address" in body) ||
    Object.keys(body).some((key) => key !== "address" && key !== "cursor" && key !== "kind")
  ) {
    return jsonError("The history request is invalid.", 400);
  }

  const requestBody = body as { address?: unknown; cursor?: unknown; kind?: unknown };
  if (
    typeof requestBody.address !== "string" ||
    !isAddress(requestBody.address, { strict: false }) ||
    (requestBody.cursor !== undefined &&
      requestBody.cursor !== null &&
      typeof requestBody.cursor !== "string") ||
    (requestBody.kind !== undefined &&
      requestBody.kind !== "all" &&
      requestBody.kind !== "normal" &&
      requestBody.kind !== "internal" &&
      requestBody.kind !== "erc20")
  ) {
    return jsonError("The history request is invalid.", 400);
  }

  try {
    const history = await getEtherscanHistory(
      requestBody.address.toLowerCase() as Address,
      typeof requestBody.cursor === "string" ? requestBody.cursor : null,
      (requestBody.kind ?? "all") as TransactionHistoryKind | "all",
    );
    return Response.json(history, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HistoryServiceError) {
      switch (error.code) {
        case "missing-key":
          return jsonError(error.message, 503);
        case "cursor":
          return jsonError("The history cursor is invalid. Refresh history to continue.", 400);
        case "rate-limit":
          return jsonError("The history provider is busy. Try again shortly.", 429);
        case "provider":
          return jsonError("Could not load transaction history. Try again later.", 502);
      }
    }
    return jsonError("Could not load transaction history. Try again later.", 502);
  }
}
