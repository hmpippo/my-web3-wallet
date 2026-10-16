import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isAddress, type Address, type Hash } from "viem";
import { publicClient } from "@/core/chain";
import type {
  TransactionHistoryItem,
  TransactionHistoryKind,
  TransactionHistoryPage,
  TransactionHistoryStatus,
} from "@/types/transaction-history";

const API_URL = "https://api.etherscan.io/v2/api";
const CHAIN_ID = "11155111";
const PAGE_SIZE = 10;
const UPSTREAM_PAGE_SIZE = 20;
const MAX_CURSOR_LENGTH = 100_000;
const MAX_CURSOR_BYTES = 75_000;
const REQUEST_TIMEOUT_MS = 10_000;
const NO_RECORDS_PATTERN = /^no (transactions|records) found\.?$/i;

const SOURCE_CONFIG = {
  normal: { action: "txlist" },
  internal: { action: "txlistinternal" },
  erc20: { action: "tokentx" },
} as const satisfies Record<TransactionHistoryKind, { action: string }>;

type HistorySource = keyof typeof SOURCE_CONFIG;
type RawRecord = Record<string, unknown>;

interface CursorItem extends TransactionHistoryItem {
  sourceOrder: number;
}

interface SourceCursor {
  nextPage: number;
  done: boolean;
  items: CursorItem[];
}

interface CursorPayload {
  version: 1;
  address: string;
  endBlock: string;
  kind: TransactionHistoryKind | "all";
  sources: Record<HistorySource, SourceCursor>;
}

interface EtherscanResponse {
  status: unknown;
  message: unknown;
  result: unknown;
}

const inFlightPages = new Map<string, Promise<TransactionHistoryPage>>();

export type HistoryServiceErrorCode =
  | "missing-key"
  | "rate-limit"
  | "provider"
  | "cursor";

export class HistoryServiceError extends Error {
  constructor(
    readonly code: HistoryServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HistoryServiceError";
  }
}

function emptyCursor(
  address: string,
  endBlock: string,
  kind: TransactionHistoryKind | "all",
): CursorPayload {
  return {
    version: 1,
    address,
    endBlock,
    kind,
    sources: {
      normal: { nextPage: 1, done: kind !== "all" && kind !== "normal", items: [] },
      internal: { nextPage: 1, done: kind !== "all" && kind !== "internal", items: [] },
      erc20: { nextPage: 1, done: kind !== "all" && kind !== "erc20", items: [] },
    },
  };
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDigits(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function parseOptionalIndex(value: unknown): number | null {
  if (!isDigits(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requiredString(record: RawRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new HistoryServiceError("provider", "The history provider returned invalid data.");
  }
  return value;
}

function requiredAddress(record: RawRecord, field: string): Address {
  const value = requiredString(record, field);
  if (!isAddress(value, { strict: false })) {
    throw new HistoryServiceError("provider", "The history provider returned invalid data.");
  }
  return value.toLowerCase() as Address;
}

function optionalAddress(value: unknown): Address | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!isAddress(value, { strict: false })) {
    throw new HistoryServiceError("provider", "The history provider returned invalid data.");
  }
  return value.toLowerCase() as Address;
}

function getStatus(record: RawRecord, kind: HistorySource): TransactionHistoryStatus {
  const isError = record.isError;
  const receiptStatus = record.txreceipt_status;
  if (isError === "1" || receiptStatus === "0") return "failed";
  if (isError === "0" || receiptStatus === "1") return "success";
  return kind === "erc20" ? "success" : "unknown";
}

function normalizeRecord(
  raw: unknown,
  kind: HistorySource,
  page: number,
  index: number,
): CursorItem {
  if (!isRecord(raw)) {
    throw new HistoryServiceError("provider", "The history provider returned invalid data.");
  }

  const blockNumber = requiredString(raw, "blockNumber");
  const timestampValue = requiredString(raw, "timeStamp");
  const value = requiredString(raw, "value");
  const hashValue = requiredString(raw, "hash");
  const timestamp = Number(timestampValue);

  if (
    !isDigits(blockNumber) ||
    !isDigits(timestampValue) ||
    !Number.isSafeInteger(timestamp) ||
    !isDigits(value) ||
    !/^0x[a-fA-F0-9]{64}$/.test(hashValue)
  ) {
    throw new HistoryServiceError("provider", "The history provider returned invalid data.");
  }

  const transactionIndex = parseOptionalIndex(raw.transactionIndex);
  const token =
    kind === "erc20"
      ? (() => {
          const decimalsValue = requiredString(raw, "tokenDecimal");
          const decimals = Number(decimalsValue);
          if (!isDigits(decimalsValue) || !Number.isInteger(decimals) || decimals > 255) {
            throw new HistoryServiceError("provider", "The history provider returned invalid data.");
          }
          return {
            contractAddress: requiredAddress(raw, "contractAddress"),
            name: boundedText(raw.tokenName, "Unknown token", 80),
            symbol: boundedText(raw.tokenSymbol, "TOKEN", 32),
            decimals,
          };
        })()
      : null;

  const identity =
    kind === "internal"
      ? boundedText(raw.traceId, `${page}:${index}`, 128)
      : kind === "erc20"
        ? boundedText(raw.logIndex, `${page}:${index}`, 128)
        : `${page}:${index}`;

  return {
    id: `${kind}:${hashValue.toLowerCase()}:${identity}`,
    kind,
    hash: hashValue.toLowerCase() as Hash,
    blockNumber,
    timestamp,
    transactionIndex,
    from: requiredAddress(raw, "from"),
    to: optionalAddress(raw.to),
    value,
    status: getStatus(raw, kind),
    token,
    sourceOrder: (page - 1) * UPSTREAM_PAGE_SIZE + index,
  };
}

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.slice(0, maxLength);
}

function isEmptyResponse(response: EtherscanResponse): boolean {
  if (Array.isArray(response.result) && response.result.length === 0) return true;
  const result = typeof response.result === "string" ? response.result.trim() : "";
  const message = typeof response.message === "string" ? response.message.trim() : "";
  return NO_RECORDS_PATTERN.test(result) || NO_RECORDS_PATTERN.test(message);
}

function isRateLimitMessage(message: string): boolean {
  return /max rate limit|rate limit reached|too many requests/i.test(message);
}

async function fetchSourcePage(
  address: string,
  endBlock: string,
  source: HistorySource,
  page: number,
  apiKey: string,
): Promise<CursorItem[]> {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    chainid: CHAIN_ID,
    module: "account",
    action: SOURCE_CONFIG[source].action,
    address,
    endblock: endBlock,
    page: String(page),
    offset: String(UPSTREAM_PAGE_SIZE),
    sort: "desc",
    apikey: apiKey,
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new HistoryServiceError("provider", "Could not reach the transaction history provider.");
  }

  if (response.status === 429) {
    throw new HistoryServiceError("rate-limit", "The transaction history provider is rate limiting requests.");
  }
  if (!response.ok) {
    throw new HistoryServiceError("provider", "The transaction history provider returned an error.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HistoryServiceError("provider", "The transaction history provider returned invalid data.");
  }

  if (!isRecord(body) || !("status" in body) || !("message" in body) || !("result" in body)) {
    throw new HistoryServiceError("provider", "The transaction history provider returned invalid data.");
  }
  const apiResponse: EtherscanResponse = {
    status: body.status,
    message: body.message,
    result: body.result,
  };

  if (apiResponse.status === "0") {
    const errorText = [
      typeof apiResponse.message === "string" ? apiResponse.message : "",
      typeof apiResponse.result === "string" ? apiResponse.result : "",
    ].join(" ");
    if (isRateLimitMessage(errorText)) {
      throw new HistoryServiceError("rate-limit", "The transaction history provider is rate limiting requests.");
    }
    if (isEmptyResponse(apiResponse)) return [];
    throw new HistoryServiceError("provider", "The transaction history provider rejected the request.");
  }

  if (apiResponse.status !== "1" || !Array.isArray(apiResponse.result)) {
    throw new HistoryServiceError("provider", "The transaction history provider returned invalid data.");
  }
  if (apiResponse.result.length > UPSTREAM_PAGE_SIZE) {
    throw new HistoryServiceError("provider", "The transaction history provider returned too many records.");
  }

  return apiResponse.result.map((record, index) => normalizeRecord(record, source, page, index));
}

function isCursorItem(value: unknown, source: HistorySource): value is CursorItem {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.kind !== source ||
    typeof value.hash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(value.hash) ||
    typeof value.blockNumber !== "string" ||
    !isDigits(value.blockNumber) ||
    !Number.isSafeInteger(value.timestamp) ||
    typeof value.from !== "string" ||
    !isAddress(value.from, { strict: false }) ||
    (value.to !== null && (typeof value.to !== "string" || !isAddress(value.to, { strict: false }))) ||
    typeof value.value !== "string" ||
    !isDigits(value.value) ||
    !Number.isSafeInteger(value.sourceOrder) ||
    (value.status !== "success" && value.status !== "failed" && value.status !== "unknown")
  ) {
    return false;
  }

  if (source === "erc20") {
    if (!isRecord(value.token)) return false;
    return (
      typeof value.token.contractAddress === "string" &&
      isAddress(value.token.contractAddress, { strict: false }) &&
      typeof value.token.name === "string" &&
      typeof value.token.symbol === "string" &&
      Number.isInteger(value.token.decimals) &&
      Number(value.token.decimals) >= 0 &&
      Number(value.token.decimals) <= 255
    );
  }
  return value.token === null;
}

function decodeCursor(
  encoded: string,
  address: string,
  kind: TransactionHistoryKind | "all",
  apiKey: string,
): CursorPayload {
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }
  const separator = encoded.lastIndexOf(".");
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }

  const payloadPart = encoded.slice(0, separator);
  const signaturePart = encoded.slice(separator + 1);
  const expectedSignature = createHmac("sha256", apiKey).update(payloadPart).digest();
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(signaturePart, "base64url");
  } catch {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }

  let parsed: unknown;
  try {
    const payloadBytes = Buffer.from(payloadPart, "base64url");
    if (payloadBytes.length > MAX_CURSOR_BYTES) {
      throw new Error("Cursor is too large.");
    }
    parsed = JSON.parse(payloadBytes.toString("utf8")) as unknown;
  } catch {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.address !== address ||
    parsed.kind !== kind ||
    typeof parsed.endBlock !== "string" ||
    !isDigits(parsed.endBlock) ||
    !isRecord(parsed.sources)
  ) {
    throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
  }

  for (const source of Object.keys(SOURCE_CONFIG) as HistorySource[]) {
    const state = parsed.sources[source];
    if (
      !isRecord(state) ||
      !Number.isSafeInteger(state.nextPage) ||
      Number(state.nextPage) < 1 ||
      Number(state.nextPage) > 100_000 ||
      typeof state.done !== "boolean" ||
      !Array.isArray(state.items) ||
      state.items.length > UPSTREAM_PAGE_SIZE ||
      !state.items.every((item) => isCursorItem(item, source))
    ) {
      throw new HistoryServiceError("cursor", "The transaction history cursor is invalid.");
    }
  }

  return parsed as unknown as CursorPayload;
}

function encodeCursor(payload: CursorPayload, apiKey: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", apiKey).update(payloadPart).digest("base64url");
  const encoded = `${payloadPart}.${signature}`;
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new HistoryServiceError("provider", "Transaction history could not be paginated safely.");
  }
  return encoded;
}

function compareItems(a: CursorItem, b: CursorItem): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  const blockDifference = BigInt(b.blockNumber) - BigInt(a.blockNumber);
  if (blockDifference !== BigInt(0)) return blockDifference > 0 ? 1 : -1;
  if (a.transactionIndex !== null && b.transactionIndex !== null && a.transactionIndex !== b.transactionIndex) {
    return b.transactionIndex - a.transactionIndex;
  }
  const kindOrder: Record<TransactionHistoryKind, number> = {
    normal: 0,
    internal: 1,
    erc20: 2,
  };
  if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
  if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
  return a.id.localeCompare(b.id);
}

async function fillSource(
  state: SourceCursor,
  source: HistorySource,
  address: string,
  endBlock: string,
  apiKey: string,
): Promise<void> {
  if (state.done || state.items.length > 0) return;
  const page = state.nextPage;
  const items = await fetchSourcePage(address, endBlock, source, page, apiKey);
  state.nextPage += 1;
  state.done = items.length < UPSTREAM_PAGE_SIZE;
  state.items = items;
}

function hasMore(payload: CursorPayload): boolean {
  return (Object.keys(SOURCE_CONFIG) as HistorySource[]).some((source) => {
    const state = payload.sources[source];
    return state.items.length > 0 || !state.done;
  });
}

async function loadHistoryPage(
  address: Address,
  cursorValue: string | null,
  kind: TransactionHistoryKind | "all",
  apiKey: string,
): Promise<TransactionHistoryPage> {
  const normalizedAddress = address.toLowerCase();
  let payload: CursorPayload;
  if (cursorValue) {
    payload = decodeCursor(cursorValue, normalizedAddress, kind, apiKey);
  } else {
    let endBlock: bigint;
    try {
      endBlock = await publicClient.getBlockNumber();
    } catch {
      throw new HistoryServiceError("provider", "Could not determine the current Sepolia block.");
    }
    payload = emptyCursor(normalizedAddress, endBlock.toString(), kind);
  }
  const sources = Object.keys(SOURCE_CONFIG) as HistorySource[];

  await Promise.all(
    sources.map((source) =>
      fillSource(payload.sources[source], source, normalizedAddress, payload.endBlock, apiKey),
    ),
  );

  const selected: CursorItem[] = [];
  while (selected.length < PAGE_SIZE) {
    const available = sources
      .map((source) => ({ source, item: payload.sources[source].items[0] }))
      .filter((candidate): candidate is { source: HistorySource; item: CursorItem } => Boolean(candidate.item));
    if (available.length === 0) {
      const unfinished = sources.filter((source) => !payload.sources[source].done);
      if (unfinished.length === 0) break;
      await Promise.all(
        unfinished.map((source) =>
          fillSource(payload.sources[source], source, normalizedAddress, payload.endBlock, apiKey),
        ),
      );
      continue;
    }

    available.sort((a, b) => compareItems(a.item, b.item));
    const next = available[0];
    selected.push(payload.sources[next.source].items.shift()!);
    if (selected.length < PAGE_SIZE) {
      await fillSource(
        payload.sources[next.source],
        next.source,
        normalizedAddress,
        payload.endBlock,
        apiKey,
      );
    }
  }

  await Promise.all(
    sources
      .filter((source) => payload.sources[source].items.length === 0 && !payload.sources[source].done)
      .map((source) =>
        fillSource(payload.sources[source], source, normalizedAddress, payload.endBlock, apiKey),
      ),
  );

  return {
    items: selected.map((item) => {
      const { sourceOrder, ...publicItem } = item;
      void sourceOrder;
      return publicItem;
    }),
    nextCursor: hasMore(payload) ? encodeCursor(payload, apiKey) : null,
  };
}

export async function getEtherscanHistory(
  address: Address,
  cursorValue?: string | null,
  kind: TransactionHistoryKind | "all" = "all",
): Promise<TransactionHistoryPage> {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new HistoryServiceError("missing-key", "Transaction history is not configured on this server.");
  }

  const normalizedAddress = address.toLowerCase();
  const normalizedCursor = cursorValue ?? null;
  const requestKey = `${normalizedAddress}:${kind}:${normalizedCursor ?? "first-page"}`;
  const existingRequest = inFlightPages.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = loadHistoryPage(normalizedAddress as Address, normalizedCursor, kind, apiKey);
  inFlightPages.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (inFlightPages.get(requestKey) === request) {
      inFlightPages.delete(requestKey);
    }
  }
}
