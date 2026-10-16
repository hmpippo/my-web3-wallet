"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatUnits, type Address } from "viem";
import { getTransactionHistory } from "@/services/transaction-history";
import type {
  TransactionHistoryItem,
  TransactionHistoryKind,
  TransactionHistoryPage,
} from "@/types/transaction-history";

const HISTORY_TABS: { kind: TransactionHistoryKind; label: string }[] = [
  { kind: "normal", label: "Transactions" },
  { kind: "internal", label: "Internal Transactions" },
  { kind: "erc20", label: "Token Transfers (ERC-20)" },
];

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
  const [selectedKind, setSelectedKind] = useState<TransactionHistoryKind>("normal");
  const [initialRetry, setInitialRetry] = useState(0);
  const isLoadingPage = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++requestSequence.current;
    isLoadingPage.current = false;
    getTransactionHistory(address, null, selectedKind)
      .then((page: TransactionHistoryPage) => {
        if (!active || requestSequence.current !== requestId) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (!active || requestSequence.current !== requestId) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load transaction history. Try again later.",
        );
      })
      .finally(() => {
        if (active && requestSequence.current === requestId) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [address, initialRetry, selectedKind]);

  async function loadNextPage(cursor: string) {
    if (isLoadingPage.current) return;
    const requestId = ++requestSequence.current;
    isLoadingPage.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const page = await getTransactionHistory(address, cursor, selectedKind);
      if (requestSequence.current !== requestId) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause: unknown) {
      if (requestSequence.current !== requestId) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load transaction history. Try again later.",
      );
    } finally {
      if (requestSequence.current === requestId) {
        isLoadingPage.current = false;
        setIsLoading(false);
      }
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

  function selectTab(kind: TransactionHistoryKind) {
    if (kind === selectedKind) return;
    requestSequence.current += 1;
    isLoadingPage.current = false;
    setItems([]);
    setNextCursor(null);
    setError(null);
    setIsLoading(true);
    setSelectedKind(kind);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % HISTORY_TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + HISTORY_TABS.length) % HISTORY_TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = HISTORY_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = HISTORY_TABS[nextIndex];
    selectTab(nextTab.kind);
    document.getElementById(`history-tab-${nextTab.kind}`)?.focus();
  }

  const selectedTabId = `history-tab-${selectedKind}`;

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
      </div>

      <div className="history-tabs" role="tablist" aria-label="Transaction types">
        {HISTORY_TABS.map((tab, index) => (
          <button
            key={tab.kind}
            id={`history-tab-${tab.kind}`}
            className="history-tab"
            type="button"
            role="tab"
            aria-selected={selectedKind === tab.kind}
            aria-controls="history-tabpanel"
            tabIndex={selectedKind === tab.kind ? 0 : -1}
            onClick={() => selectTab(tab.kind)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id="history-tabpanel"
        className="history-tabpanel"
        role="tabpanel"
        aria-labelledby={selectedTabId}
        aria-busy={isLoading}
        tabIndex={0}
      >
        {isLoading && items.length === 0 ? (
          <p className="history-message" role="status">
            Loading {HISTORY_TABS.find((tab) => tab.kind === selectedKind)?.label.toLowerCase()}...
          </p>
        ) : null}

        {error ? (
          <div className="history-error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}

        {!isLoading && !error && items.length === 0 ? (
          <p className="history-message">
            No {HISTORY_TABS.find((tab) => tab.kind === selectedKind)?.label.toLowerCase()} found for
            this address.
          </p>
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
      </div>
    </section>
  );
}
