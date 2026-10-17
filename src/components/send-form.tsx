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
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { getExplorerTxUrl } from "@/core/chain";
import type { StoredWalletToken } from "@/core/storage";
import { useActiveChain } from "@/lib/use-active-chain";
import { CopyButton } from "@/components/copy-button";
import {
  estimateErc20Transfer,
  estimateNativeTransfer,
  type NativeTransferEstimate,
} from "@/services/transaction-service";
import { selectAccountTokens, walletService } from "@/services/wallet-service";

const NATIVE_ASSET = "native";

interface TransferReview {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  estimate: NativeTransferEstimate;
  token: StoredWalletToken | null;
}

export function SendForm() {
  const { chainId, chain, isTestnet } = useActiveChain();
  const native = chain.nativeCurrency;
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
    () =>
      (selectedAccount ? selectAccountTokens(selectedAccount, chainId) : [])
        .filter((token) => !token.hidden),
    [selectedAccount, chainId],
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
  const [submission, setSubmission] = useState<{
    hash: Hash;
    chainId: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [renderedChainId, setRenderedChainId] = useState(chainId);

  const requestedTokenMatch = requestedToken
    ? visibleTokens.find(
        (token) =>
          token.address.toLowerCase() === requestedToken.toLowerCase(),
      )
    : undefined;
  const preferredAssetId =
    assetId ?? requestedTokenMatch?.address ?? NATIVE_ASSET;
  const selectedToken =
    preferredAssetId === NATIVE_ASSET
      ? null
      : visibleTokens.find((token) => token.address === preferredAssetId) ??
        null;
  // The select must always point at an asset that exists on the active chain,
  // so an asset chosen on a previous network falls back to the native coin.
  const assetValue = selectedToken ? selectedToken.address : NATIVE_ASSET;
  const assetSymbol = selectedToken ? selectedToken.symbol : native.symbol;

  // The active chain changed: a pending review, submission, or error from the
  // previous network no longer applies. Adjusting state during render (rather
  // than in an effect) avoids rendering once with stale values.
  if (renderedChainId !== chainId) {
    setRenderedChainId(chainId);
    setReview(null);
    setSubmission(null);
    setError(null);
    setIsBusy(false);
  }

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
    setSubmission(null);
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
        : parseUnits(amount, native.decimals);
      const estimate = selectedToken
        ? await estimateErc20Transfer({
            from,
            token: selectedToken.address,
            to: recipient,
            amount: value,
            chainId,
          })
        : await estimateNativeTransfer({
            from,
            to: recipient,
            value,
            chainId,
          });
      if (requestId !== reviewRequestId.current) return;
      if (!walletService.isUnlocked || walletService.getAddress() !== from) {
        throw new Error("Selected account changed while preparing the transfer.");
      }
      setReview({
        chainId,
        from,
        to: recipient,
        value,
        estimate,
        token: selectedToken,
      });
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
            chainId: review.chainId,
            estimate: review.estimate,
          })
        : await walletService.signAndSendTransaction({
            from: review.from,
            to: review.to,
            value: review.value,
            chainId: review.chainId,
            estimate: review.estimate,
          });
      setSubmission({ hash, chainId: review.chainId });
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

  const explorerTxUrl = submission
    ? getExplorerTxUrl(submission.chainId, submission.hash)
    : null;

  return (
    <main className="page-main">
      <section className="page-heading">
        <p className="eyebrow">
          {chain.name} {isTestnet ? "testnet" : "mainnet"}
        </p>
        <h1>Send</h1>
        <p>
          Send {native.symbol} or any ERC-20 token you have added to this account
          on {chain.name}. Check the recipient and estimated network fee before
          confirming.
        </p>
      </section>

      <section className="preview-card" aria-label="Send">
        <form className="send-fields" onSubmit={reviewTransfer}>
          <p className="muted-copy send-account">
            Sending from {selectedAddress ?? "locked wallet"}
            {selectedAddress ? (
              <CopyButton label="your address" value={selectedAddress} />
            ) : null}
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
              value={assetValue}
            >
              <option value={NATIVE_ASSET}>{native.symbol} (native)</option>
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
                <dd className="address-line">
                  {review.from}
                  <CopyButton label="sender address" value={review.from} />
                </dd>
              </div>
              <div>
                <dt>To</dt>
                <dd className="address-line">
                  {review.to}
                  <CopyButton label="recipient address" value={review.to} />
                </dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {review.token
                    ? `${formatUnits(review.value, review.token.decimals)} ${review.token.symbol}`
                    : `${formatUnits(review.value, native.decimals)} ${native.symbol}`}
                </dd>
              </div>
              {review.token ? (
                <div>
                  <dt>Token contract</dt>
                  <dd className="address-line">
                    {review.token.address}
                    <CopyButton
                      label={`${review.token.symbol} contract address`}
                      value={review.token.address}
                    />
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Estimated network fee</dt>
                <dd>
                  {formatUnits(review.estimate.estimatedFee, native.decimals)}{" "}
                  {native.symbol}
                </dd>
              </div>
              {!review.token ? (
                <div>
                  <dt>Estimated total</dt>
                  <dd>
                    {formatUnits(
                      review.value + review.estimate.estimatedFee,
                      native.decimals,
                    )}{" "}
                    {native.symbol}
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
        {submission && (
          <p className="success-message" role="status">
            Transaction submitted:{" "}
            {explorerTxUrl ? (
              <a href={explorerTxUrl} rel="noreferrer" target="_blank">
                {submission.hash}
              </a>
            ) : (
              submission.hash
            )}
          </p>
        )}
        <Link className="text-link back-link" href="/wallet">
          Back to wallet
        </Link>
      </section>
    </main>
  );
}
