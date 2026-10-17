"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { Address } from "viem";
import type { StoredWalletToken } from "@/core/storage";
import { getTokenBalance } from "@/services/token-service";
import { walletService } from "@/services/wallet-service";

interface TokenPortfolioProps {
  accountAddress: Address;
  tokens: readonly StoredWalletToken[];
}

interface TokenBalanceState {
  formatted?: string;
  error?: string;
  loading: boolean;
}

export function TokenPortfolio({
  accountAddress,
  tokens,
}: TokenPortfolioProps) {
  const [contractAddress, setContractAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, TokenBalanceState>>(
    {},
  );
  const [isManagingTokens, setIsManagingTokens] = useState(false);

  const visibleTokens = useMemo(
    () => tokens.filter((token) => !token.hidden),
    [tokens],
  );
  const hiddenTokens = useMemo(
    () => tokens.filter((token) => token.hidden),
    [tokens],
  );

  const refreshBalance = useCallback(
    async (token: StoredWalletToken) => {
      const key = token.address.toLowerCase();
      setBalances((current) => ({
        ...current,
        [key]: { loading: true },
      }));
      try {
        const result = await getTokenBalance(token, accountAddress);
        setBalances((current) => ({
          ...current,
          [key]: { loading: false, formatted: result.formatted },
        }));
      } catch (caught) {
        setBalances((current) => ({
          ...current,
          [key]: {
            loading: false,
            error:
              caught instanceof Error
                ? caught.message
                : `Could not load the ${token.symbol} token balance.`,
          },
        }));
      }
    },
    [accountAddress],
  );

  useEffect(() => {
    let cancelled = false;
    setBalances({});
    void Promise.all(
      visibleTokens.map(async (token) => {
        try {
          const result = await getTokenBalance(token, accountAddress);
          if (!cancelled) {
            setBalances((current) => ({
              ...current,
              [token.address.toLowerCase()]: {
                loading: false,
                formatted: result.formatted,
              },
            }));
          }
        } catch (caught) {
          if (!cancelled) {
            setBalances((current) => ({
              ...current,
              [token.address.toLowerCase()]: {
                loading: false,
                error:
                  caught instanceof Error
                    ? caught.message
                    : `Could not load the ${token.symbol} token balance.`,
              },
            }));
          }
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [accountAddress, visibleTokens]);

  async function addToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      await walletService.addToken(contractAddress);
      setContractAddress("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not add this token contract.",
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function changeVisibility(token: StoredWalletToken, hidden: boolean) {
    setError(null);
    try {
      if (hidden) {
        await walletService.restoreToken(token.address);
      } else {
        await walletService.hideToken(token.address);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update the token visibility.",
      );
    }
  }

  return (
    <section className="history-card token-card" aria-labelledby="tokens-heading">
      <div className="history-heading">
        <div>
          <p className="eyebrow">Sepolia assets</p>
          <h2 id="tokens-heading">Tokens</h2>
        </div>
        <button
          className="text-link"
          disabled={visibleTokens.length === 0}
          onClick={() => void Promise.all(visibleTokens.map(refreshBalance))}
          type="button"
        >
          Refresh balances
        </button>
      </div>

      <form className="token-add-form" onSubmit={addToken}>
        <label htmlFor="token-contract-address">Add ERC-20 token</label>
        <div className="token-add-controls">
          <input
            autoComplete="off"
            id="token-contract-address"
            onChange={(event) => setContractAddress(event.target.value)}
            placeholder="Token contract address"
            required
            spellCheck={false}
            value={contractAddress}
          />
          <button
            className="button button-primary"
            disabled={isAdding}
            type="submit"
          >
            {isAdding ? "Checking..." : "Add token"}
          </button>
        </div>
        <p className="field-help">
          Token name, symbol, and decimals are verified from the Sepolia contract.
        </p>
      </form>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {visibleTokens.length === 0 ? (
        <p className="muted-copy token-empty">
          No tokens added for this account yet. Add an ERC-20 contract address
          to view its balance.
        </p>
      ) : (
        <ul className="token-list" aria-label="ERC-20 tokens">
          {visibleTokens.map((token) => {
            const balance = balances[token.address.toLowerCase()];
            return (
              <li className="token-item" key={token.address}>
                <div className="token-identity">
                  <strong>{token.name}</strong>
                  <span>{token.symbol}</span>
                  <code>{token.address}</code>
                </div>
                <div className="token-balance">
                  {balance?.loading || !balance ? (
                    <span role="status">Loading...</span>
                  ) : balance.error ? (
                    <div className="token-balance-error">
                      <span role="alert">{balance.error}</span>
                      <button
                        className="text-link"
                        onClick={() => void refreshBalance(token)}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <strong>
                      {balance.formatted} {token.symbol}
                    </strong>
                  )}
                </div>
                <button
                  aria-label={`Hide ${token.name}`}
                  className="text-button"
                  onClick={() => void changeVisibility(token, false)}
                  type="button"
                >
                  Hide
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="token-management">
        <button
          aria-controls="hidden-token-list"
          aria-expanded={isManagingTokens}
          className="text-link"
          onClick={() => setIsManagingTokens((open) => !open)}
          type="button"
        >
          {isManagingTokens ? "Close token management" : "Manage hidden tokens"}
        </button>
        {isManagingTokens ? (
          <div className="hidden-token-list" id="hidden-token-list">
            {hiddenTokens.length === 0 ? (
              <p className="muted-copy">No hidden tokens for this account.</p>
            ) : (
              hiddenTokens.map((token) => (
                <div className="hidden-token-row" key={token.address}>
                  <div className="token-identity">
                    <strong>{token.name}</strong>
                    <span>{token.symbol}</span>
                    <code>{token.address}</code>
                  </div>
                  <button
                    aria-label={`Show ${token.name}`}
                    className="button button-outline"
                    onClick={() => void changeVisibility(token, true)}
                    type="button"
                  >
                    Show
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
