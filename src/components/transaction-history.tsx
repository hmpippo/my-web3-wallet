"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { getTransactionHistory } from "@/services/transaction-history";
import type {
  TransactionHistoryItem,
  TransactionHistoryPage,
} from "@/types/transaction-history";

interface TransactionHistoryProps {
  address: Address;
}

function describeActivity(item: TransactionHistoryItem, address: Address): string {
  const direction =
    item.from.toLowerCase() === address.toLowerCase()
      ? item.to?.toLowerCase() === address.toLowerCase()
        ? "Self transfer"
        : "Sent"
      : "Received";
  const kind =
    item.kind === "erc20"
      ? `ERC-20 ${item.token?.symbol ?? "token"} transfer`
      : item.kind === "internal"
        ? "Internal ETH transfer"
        : "ETH transfer";
  return `${kind} · ${direction}`;
}

function formatAmount(item: TransactionHistoryItem): string {
  return formatUnits(BigInt(item.value), item.token?.decimals ?? 18);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function TransactionHistory({ address }: TransactionHistoryProps) {
  const [items, setItems] = useState<TransactionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialRetry, setInitialRetry] = useState(0);
  const isLoadingPage = useRef(false);

  useEffect(() => {
    let active = true;
    getTransactionHistory(address, null)
      .then((page: TransactionHistoryPage) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load transaction history. Try again later.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [address, initialRetry]);

  async function loadNextPage(cursor: string) {
    if (isLoadingPage.current) return;
    isLoadingPage.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const page = await getTransactionHistory(address, cursor);
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load transaction history. Try again later.",
      );
    } finally {
      isLoadingPage.current = false;
      setIsLoading(false);
    }
  }

  function retry() {
    setError(null);
    setIsLoading(true);
    if (items.length > 0 && nextCursor) {
      void loadNextPage(nextCursor);
      return;
    }
    setInitialRetry((current) => current + 1);
  }

  return (
    <section
      className="history-card"
      aria-labelledby="history-heading"
      aria-busy={isLoading}
    >
      <div className="history-heading">
        <div>
          <p className="eyebrow">Sepolia activity</p>
          <h2 id="history-heading">Transaction history</h2>
        </div>
        <span className="history-scope">ETH · Internal · ERC-20</span>
      </div>

      {isLoading && items.length === 0 ? (
        <p className="history-message" role="status">
          Loading transaction history...
        </p>
      ) : null}

      {error ? (
        <div className="history-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {!isLoading && !error && items.length === 0 ? (
        <p className="history-message">No Sepolia activity found for this address.</p>
      ) : null}

      {items.length > 0 ? (
        <ol className="history-list">
          {items.map((item) => {
            const symbol = item.token?.symbol ?? "ETH";
            const counterparty =
              item.from.toLowerCase() === address.toLowerCase()
                ? item.to
                : item.from;
            return (
              <li className="history-item" key={item.id}>
                <div className="history-item-main">
                  <div className="history-item-title">
                    <span>{describeActivity(item, address)}</span>
                    <span className={`history-status history-status-${item.status}`}>
                      {item.status === "failed"
                        ? "Failed"
                        : item.status === "success"
                          ? "Confirmed"
                          : "Status unknown"}
                    </span>
                  </div>
                  <time dateTime={new Date(item.timestamp * 1000).toISOString()}>
                    {formatTimestamp(item.timestamp)}
                  </time>
                  <code className="history-counterparty">
                    {counterparty ?? "Contract creation"}
                  </code>
                  <a
                    className="history-hash"
                    href={`https://sepolia.etherscan.io/tx/${item.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                </div>
                <p className="history-amount">
                  {formatAmount(item)} <span>{symbol}</span>
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}

      {error ? (
        <button className="button button-outline history-more" onClick={retry} type="button">
          {items.length > 0 ? "Try loading again" : "Try again"}
        </button>
      ) : nextCursor ? (
        <button
          className="button button-outline history-more"
          onClick={() => void loadNextPage(nextCursor)}
          type="button"
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
