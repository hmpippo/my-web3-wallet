"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { CHAIN } from "@/core/chain";
import type { StoredWalletToken } from "@/core/storage";
import {
  estimateErc20Transfer,
  estimateNativeTransfer,
  type NativeTransferEstimate,
} from "@/services/transaction-service";
import { walletService } from "@/services/wallet-service";

const NATIVE_ASSET = "native";

interface TransferReview {
  from: Address;
  to: Address;
  value: bigint;
  estimate: NativeTransferEstimate;
  token: StoredWalletToken | null;
}

export function SendForm() {
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const selectedAddress = walletState.address;
  const selectedAccount = walletState.accounts.find(
    (account) => account.index === walletState.selectedAccountIndex,
  );
  const visibleTokens = useMemo(
    () => (selectedAccount?.tokens ?? []).filter((token) => !token.hidden),
    [selectedAccount],
  );
  const searchParams = useSearchParams();
  const requestedToken = searchParams.get("token");
  const reviewRequestId = useRef(0);
  const sendInProgress = useRef(false);
  // `null` means "no explicit choice yet", so an incoming `?token=` request
  // still selects the token without fighting a stale default.
  const [assetId, setAssetId] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<TransferReview | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const requestedTokenMatch = requestedToken
    ? visibleTokens.find(
        (token) =>
          token.address.toLowerCase() === requestedToken.toLowerCase(),
      )
    : undefined;
  const effectiveAssetId = assetId ?? requestedTokenMatch?.address ?? NATIVE_ASSET;
  const selectedToken =
    effectiveAssetId === NATIVE_ASSET
      ? null
      : visibleTokens.find((token) => token.address === effectiveAssetId) ??
        null;
  const assetSymbol = selectedToken ? selectedToken.symbol : "ETH";

  useEffect(
    () => () => {
      reviewRequestId.current += 1;
    },
    [],
  );

  async function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setReview(null);
    setTransactionHash(null);
    setIsBusy(true);
    const requestId = ++reviewRequestId.current;

    try {
      const from = walletService.getAddress();
      if (!from) throw new Error("Wallet is locked. Unlock it to continue.");
      if (!isAddress(to)) {
        throw new TypeError("Recipient address is invalid");
      }

      const recipient = getAddress(to);
      const value = selectedToken
        ? parseUnits(amount, selectedToken.decimals)
        : parseEther(amount);
      const estimate = selectedToken
        ? await estimateErc20Transfer({
            from,
            token: selectedToken.address,
            to: recipient,
            amount: value,
          })
        : await estimateNativeTransfer({
            from,
            to: recipient,
            value,
          });
      if (requestId !== reviewRequestId.current) return;
      if (!walletService.isUnlocked || walletService.getAddress() !== from) {
        throw new Error("Selected account changed while preparing the transfer.");
      }
      setReview({ from, to: recipient, value, estimate, token: selectedToken });
    } catch (caught) {
      if (requestId === reviewRequestId.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to prepare this transaction.",
        );
      }
    } finally {
      if (requestId === reviewRequestId.current) setIsBusy(false);
    }
  }

  async function confirmTransfer() {
    if (!review || sendInProgress.current) return;
    if (!walletService.isUnlocked) {
      setReview(null);
      setError("Wallet is locked. Unlock it to continue.");
      return;
    }
    sendInProgress.current = true;
    setError(null);
    setIsBusy(true);
    try {
      const hash = review.token
        ? await walletService.signAndSendTokenTransfer({
            from: review.from,
            token: review.token.address,
            to: review.to,
            amount: review.value,
            estimate: review.estimate,
          })
        : await walletService.signAndSendTransaction({
            from: review.from,
            to: review.to,
            value: review.value,
            estimate: review.estimate,
          });
      setTransactionHash(hash);
      setReview(null);
      setAmount("");
      setTo("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Transaction failed. Please try again.",
      );
    } finally {
      sendInProgress.current = false;
      setIsBusy(false);
    }
  }

  return (
    <main className="page-main">
      <section className="page-heading">
        <p className="eyebrow">Sepolia testnet</p>
        <h1>Send</h1>
        <p>
          Send ETH or any ERC-20 token you have added to this account. Check the
          recipient and estimated network fee before confirming.
        </p>
      </section>

      <section className="preview-card" aria-label="Send">
        <form className="send-fields" onSubmit={reviewTransfer}>
          <p className="muted-copy send-account">
            Sending from {selectedAddress ?? "locked wallet"}
          </p>
          <label>
            Asset
            <select
              disabled={isBusy}
              id="send-asset"
              onChange={(event) => {
                reviewRequestId.current += 1;
                setAssetId(event.target.value);
                setReview(null);
                setIsBusy(false);
              }}
              value={effectiveAssetId}
            >
              <option value={NATIVE_ASSET}>ETH (native)</option>
              {visibleTokens.map((token) => (
                <option key={token.address} value={token.address}>
                  {token.symbol} — {token.name}
                </option>
              ))}
            </select>
          </label>
          {visibleTokens.length === 0 ? (
            <p className="field-help">
              Add an ERC-20 token in the Tokens tab to send it from here.
            </p>
          ) : null}
          <label>
            Recipient address
            <input
              autoComplete="off"
              onChange={(event) => {
                reviewRequestId.current += 1;
                setTo(event.target.value);
                setReview(null);
                setIsBusy(false);
              }}
              disabled={isBusy}
              placeholder="0x..."
              required
              spellCheck={false}
              value={to}
            />
          </label>
          <label>
            Amount ({assetSymbol})
            <input
              inputMode="decimal"
              onChange={(event) => {
                reviewRequestId.current += 1;
                setAmount(event.target.value);
                setReview(null);
                setIsBusy(false);
              }}
              disabled={isBusy}
              placeholder="0.00"
              required
              type="text"
              value={amount}
            />
          </label>
          {!review && (
            <button
              className="button button-primary"
              disabled={isBusy}
              type="submit"
            >
              {isBusy ? "Estimating fee..." : "Review transfer"}
            </button>
          )}
        </form>

        {review && (
          <div className="transfer-review" aria-live="polite">
            <h2>Review transfer</h2>
            <dl>
              <div>
                <dt>From</dt>
                <dd>{review.from}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{review.to}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {review.token
                    ? `${formatUnits(review.value, review.token.decimals)} ${review.token.symbol}`
                    : `${formatEther(review.value)} ETH`}
                </dd>
              </div>
              {review.token ? (
                <div>
                  <dt>Token contract</dt>
                  <dd>{review.token.address}</dd>
                </div>
              ) : null}
              <div>
                <dt>Estimated network fee</dt>
                <dd>{formatEther(review.estimate.estimatedFee)} ETH</dd>
              </div>
              {!review.token ? (
                <div>
                  <dt>Estimated total</dt>
                  <dd>
                    {formatEther(review.value + review.estimate.estimatedFee)} ETH
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={isBusy}
                onClick={confirmTransfer}
                type="button"
              >
                {isBusy ? "Sending..." : "Confirm and send"}
              </button>
              <button
                className="button button-outline"
                disabled={isBusy}
                onClick={() => setReview(null)}
                type="button"
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {transactionHash && (
          <p className="success-message" role="status">
            Transaction submitted:{" "}
            <a
              href={`${CHAIN.blockExplorers.default.url}/tx/${transactionHash}`}
              rel="noreferrer"
              target="_blank"
            >
              {transactionHash}
            </a>
          </p>
        )}
        <Link className="text-link back-link" href="/wallet">
          Back to wallet
        </Link>
      </section>
    </main>
  );
}
