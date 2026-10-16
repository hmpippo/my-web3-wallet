import { isAddress, isHash, type Address } from "viem";
import type {
  TransactionHistoryItem,
  TransactionHistoryKind,
  TransactionHistoryPage,
  TransactionHistoryStatus,
} from "@/types/transaction-history";

function isHistoryKind(value: unknown): value is TransactionHistoryKind {
  return value === "normal" || value === "internal" || value === "erc20";
}

function isHistoryStatus(value: unknown): value is TransactionHistoryStatus {
  return value === "success" || value === "failed" || value === "unknown";
}

function isHistoryItem(value: unknown): value is TransactionHistoryItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    !isHistoryKind(item.kind) ||
    typeof item.hash !== "string" ||
    !isHash(item.hash) ||
    typeof item.blockNumber !== "string" ||
    !/^\d+$/.test(item.blockNumber) ||
    !Number.isSafeInteger(item.timestamp) ||
    (item.transactionIndex !== null && !Number.isSafeInteger(item.transactionIndex)) ||
    typeof item.from !== "string" ||
    !isAddress(item.from, { strict: false }) ||
    (item.to !== null &&
      (typeof item.to !== "string" || !isAddress(item.to, { strict: false }))) ||
    typeof item.value !== "string" ||
    !/^\d+$/.test(item.value) ||
    !isHistoryStatus(item.status)
  ) {
    return false;
  }

  if (item.kind !== "erc20") return item.token === null;
  if (typeof item.token !== "object" || item.token === null || Array.isArray(item.token)) {
    return false;
  }
  const token = item.token as Record<string, unknown>;
  return (
    typeof token.contractAddress === "string" &&
    isAddress(token.contractAddress, { strict: false }) &&
    typeof token.name === "string" &&
    typeof token.symbol === "string" &&
    Number.isInteger(token.decimals) &&
    Number(token.decimals) >= 0 &&
    Number(token.decimals) <= 255
  );
}

function isHistoryPage(value: unknown): value is TransactionHistoryPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    page.items.every(isHistoryItem) &&
    (page.nextCursor === null || typeof page.nextCursor === "string")
  );
}

export async function getTransactionHistory(
  address: Address,
  cursor: string | null,
  kind: TransactionHistoryKind | "all" = "all",
): Promise<TransactionHistoryPage> {
  let response: Response;
  try {
    response = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, cursor, kind }),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not contact the transaction history service.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The transaction history service returned an unreadable response.");
  }

  if (!response.ok) {
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      throw new Error(body.error);
    }
    throw new Error("Could not load transaction history. Try again later.");
  }

  if (!isHistoryPage(body)) {
    throw new Error("The transaction history service returned invalid data.");
  }
  return body;
}
