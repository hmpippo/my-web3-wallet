import { isAddress, type Address } from "viem";
import { isSupportedChainId } from "@/core/chain";
import {
  clientIp,
  historyAddressLimiter,
  historyIpLimiter,
} from "@/lib/history-rate-limit";
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

function rateLimited(retryAfterMs: number): Response {
  return Response.json(
    { error: "Too many history requests. Try again shortly." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      },
    },
  );
}

/**
 * Stops other origins from driving this route from a browser. `Origin` is
 * set by the browser and cannot be forged by page script; `Sec-Fetch-Site`
 * adds a second signal where supported. Non-browser callers omit both, so
 * this is not authentication — the rate limits below handle abuse.
 */
function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
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
  if (!isSameOrigin(request)) {
    return jsonError("The history request origin is not allowed.", 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonError("The history request must be JSON.", 415);
  }

  // Cheap rejection before touching the body or the provider.
  const ipLimit = historyIpLimiter.consume(clientIp(request));
  if (!ipLimit.allowed) return rateLimited(ipLimit.retryAfterMs);

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
    Object.keys(body).some(
      (key) =>
        key !== "address" &&
        key !== "cursor" &&
        key !== "kind" &&
        key !== "chainid",
    )
  ) {
    return jsonError("The history request is invalid.", 400);
  }

  const requestBody = body as {
    address?: unknown;
    cursor?: unknown;
    kind?: unknown;
    chainid?: unknown;
  };
  if (
    typeof requestBody.address !== "string" ||
    !isAddress(requestBody.address, { strict: false }) ||
    !isSupportedChainId(requestBody.chainid) ||
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

  const addressLimit = historyAddressLimiter.consume(
    requestBody.address.toLowerCase(),
  );
  if (!addressLimit.allowed) return rateLimited(addressLimit.retryAfterMs);

  try {
    const history = await getEtherscanHistory(
      requestBody.address.toLowerCase() as Address,
      typeof requestBody.cursor === "string" ? requestBody.cursor : null,
      (requestBody.kind ?? "all") as TransactionHistoryKind | "all",
      requestBody.chainid,
    );
    return Response.json(history, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HistoryServiceError) {
      switch (error.code) {
        case "missing-key":
          return jsonError(error.message, 503);
        case "config":
          return jsonError(
            "Transaction history is not configured on this server.",
            503,
          );
        case "cursor":
          return jsonError("The history cursor is invalid. Refresh history to continue.", 400);
        case "rate-limit":
          return jsonError("The history provider is busy. Try again shortly.", 429);
        case "unsupported":
          return Response.json(
            { items: [], nextCursor: null, unavailable: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        case "provider":
          return jsonError("Could not load transaction history. Try again later.", 502);
      }
    }
    return jsonError("Could not load transaction history. Try again later.", 502);
  }
}
