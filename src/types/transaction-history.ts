import type { Address, Hash } from "viem";

export type TransactionHistoryKind = "normal" | "internal" | "erc20";
export type TransactionHistoryStatus = "success" | "failed" | "unknown";

export interface TransactionHistoryItem {
  id: string;
  kind: TransactionHistoryKind;
  hash: Hash;
  blockNumber: string;
  timestamp: number;
  transactionIndex: number | null;
  from: Address;
  to: Address | null;
  value: string;
  status: TransactionHistoryStatus;
  token: {
    contractAddress: Address;
    name: string;
    symbol: string;
    decimals: number;
  } | null;
}

export interface TransactionHistoryPage {
  items: TransactionHistoryItem[];
  nextCursor: string | null;
}
