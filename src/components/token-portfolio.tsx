"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { getWalletChain } from "@/core/chain";
import type { StoredWalletToken } from "@/core/storage";
import { getNativeBalance } from "@/services/balance-service";
import { getTokenBalance } from "@/services/token-service";
import { CopyButton } from "@/components/copy-button";
import { OverflowMenu } from "@/components/overflow-menu";

const NATIVE_KEY = "native";

interface TokenPortfolioProps {
  accountAddress: Address;
  chainId: number;
  tokens: readonly StoredWalletToken[];
}

interface TokenBalanceState {
  formatted?: string;
  error?: string;
  loading: boolean;
}

export function TokenPortfolio({
  accountAddress,
  chainId,
  tokens,
}: TokenPortfolioProps) {
  const { chain } = getWalletChain(chainId);
  const native = chain.nativeCurrency;
  const [balances, setBalances] = useState<Record<string, TokenBalanceState>>(
    {},
  );

  const visibleTokens = useMemo(
    () => tokens.filter((token) => !token.hidden),
    [tokens],
  );

  const refreshNativeBalance = useCallback(async () => {
    setBalances((current) => ({ ...current, [NATIVE_KEY]: { loading: true } }));
    try {
      const raw = await getNativeBalance(accountAddress, chainId);
      setBalances((current) => ({
        ...current,
        [NATIVE_KEY]: {
          loading: false,
          formatted: formatUnits(raw, native.decimals),
        },
      }));
    } catch (caught) {
      setBalances((current) => ({
        ...current,
        [NATIVE_KEY]: {
          loading: false,
          error:
            caught instanceof Error
              ? caught.message
              : `Could not load the ${native.symbol} balance.`,
        },
      }));
    }
  }, [accountAddress, chainId, native.decimals, native.symbol]);

  const refreshBalance = useCallback(
    async (token: StoredWalletToken) => {
      const key = token.address.toLowerCase();
      setBalances((current) => ({
        ...current,
        [key]: { loading: true },
      }));
      try {
        const result = await getTokenBalance(token, accountAddress, chainId);
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
    [accountAddress, chainId],
  );

  const refreshList = useCallback(() => {
    void Promise.all([
      refreshNativeBalance(),
      ...visibleTokens.map(refreshBalance),
    ]);
  }, [refreshNativeBalance, refreshBalance, visibleTokens]);

  useEffect(() => {
    let cancelled = false;
    setBalances({});
    void Promise.all([
      getNativeBalance(accountAddress, chainId)
        .then((raw) => {
          if (!cancelled) {
            setBalances((current) => ({
              ...current,
              [NATIVE_KEY]: {
                loading: false,
                formatted: formatUnits(raw, native.decimals),
              },
            }));
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setBalances((current) => ({
              ...current,
              [NATIVE_KEY]: {
                loading: false,
                error:
                  caught instanceof Error
                    ? caught.message
                    : `Could not load the ${native.symbol} balance.`,
              },
            }));
          }
        }),
      ...visibleTokens.map(async (token) => {
        try {
          const result = await getTokenBalance(token, accountAddress, chainId);
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
    ]);
    return () => {
      cancelled = true;
    };
  }, [accountAddress, chainId, visibleTokens, native.decimals, native.symbol]);

  return (
    <section className="history-card token-card" aria-labelledby="tokens-heading">
      <div className="history-heading">
        <div>
          <p className="eyebrow">{chain.name} assets</p>
          <h2 id="tokens-heading">Tokens</h2>
        </div>
        <OverflowMenu
          label="Token list options"
          items={[
            { label: "Refresh list", icon: "refresh", onClick: refreshList },
            { label: "Manage tokens", icon: "manage", href: "/tokens" },
          ]}
        />
      </div>

      <ul className="token-list" aria-label="Tokens">
        <li className="token-item token-item-native">
          <div className="token-identity">
            <strong>{native.name}</strong>
            <span>{native.symbol}</span>
            <span className="token-badge">Native asset</span>
          </div>
          <div className="token-balance">
            {balances[NATIVE_KEY]?.loading || !balances[NATIVE_KEY] ? (
              <span role="status">Loading...</span>
            ) : balances[NATIVE_KEY]?.error ? (
              <div className="token-balance-error">
                <span role="alert">{balances[NATIVE_KEY]?.error}</span>
                <button
                  className="text-link"
                  onClick={() => void refreshNativeBalance()}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : (
              <strong>
                {balances[NATIVE_KEY]?.formatted} {native.symbol}
              </strong>
            )}
          </div>
          <div className="token-actions">
            <Link className="text-link" href="/send">
              Send
            </Link>
          </div>
        </li>
        {visibleTokens.map((token) => {
          const balance = balances[token.address.toLowerCase()];
          return (
            <li className="token-item" key={token.address}>
              <div className="token-identity">
                <strong>{token.name}</strong>
                <span>{token.symbol}</span>
                <div className="address-line">
                  <code>{token.address}</code>
                  <CopyButton
                    label={`${token.symbol} contract address`}
                    value={token.address}
                  />
                </div>
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
              <div className="token-actions">
                <Link
                  className="text-link"
                  href={`/send?token=${token.address}`}
                >
                  Send
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      {visibleTokens.length === 0 ? (
        <p className="muted-copy token-empty">
          Add an ERC-20 contract address to track more tokens.
        </p>
      ) : null}
    </section>
  );
}
