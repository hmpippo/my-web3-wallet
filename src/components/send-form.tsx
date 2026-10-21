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
  formatGwei,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { getChain, getExplorerTxUrl } from "@/core/chain";
import { isUnusuallyHighFee } from "@/core/fees";
import type { StoredWalletToken } from "@/core/storage";
import { truncateAddress } from "@/lib/address";
import { useActiveChain } from "@/lib/use-active-chain";
import {
  parseRecipientInput,
  RecipientInputError,
} from "@/lib/recipient-input";
import { CopyButton } from "@/components/copy-button";
import { QrScannerDialog } from "@/components/qr-scanner-dialog";
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
  const recipientInputRef = useRef<HTMLTextAreaElement | null>(null);
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
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
    setScannerOpen(false);
    setScanError(null);
  }

  useEffect(
    () => () => {
      reviewRequestId.current += 1;
    },
    [],
  );

  // The recipient field wraps on narrow screens. Height is set from the
  // content so a full address is visible without a horizontal scrollbar,
  // including in browsers without `field-sizing: content`.
  useEffect(() => {
    const field = recipientInputRef.current;
    if (!field) return;

    const fitToContent = () => {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 128)}px`;
    };

    fitToContent();
    window.addEventListener("resize", fitToContent);
    return () => window.removeEventListener("resize", fitToContent);
  }, [to]);

  function chainName(id: number): string {
    try {
      return getChain(id).name;
    } catch {
      return `chain ${id}`;
    }
  }

  function describeRecipientError(caught: unknown): string {
    if (caught instanceof RecipientInputError) {
      if (caught.sourceChainId !== undefined) {
        return `This payment link is for ${chainName(caught.sourceChainId)}, but the wallet is on ${chain.name}. Switch networks before sending.`;
      }
      return caught.message;
    }
    return "Recipient address is invalid";
  }

  /**
   * Parses typed, pasted, or scanned input and resolves a token named by a
   * payment link against the tokens already added to this account. Unknown
   * tokens are never auto-imported, so a malicious link cannot hide which
   * contract the user is about to interact with.
   */
  function resolveRecipient(raw: string): {
    address: Address;
    amount?: bigint;
    token: StoredWalletToken | null;
  } {
    const parsed = parseRecipientInput(raw, { chainId });
    if (!parsed.token) {
      return { address: parsed.address, amount: parsed.amount, token: null };
    }
    const token = visibleTokens.find(
      (candidate) =>
        candidate.address.toLowerCase() === parsed.token?.toLowerCase(),
    );
    if (!token) {
      throw new RecipientInputError(
        `This payment link asks for token ${parsed.token}, which isn't added to this account. Add it in Tokens, then scan again.`,
      );
    }
    return { address: parsed.address, amount: parsed.amount, token };
  }

  function handleScan(raw: string) {
    try {
      const parsed = resolveRecipient(raw);
      if (parsed.token) {
        setAssetId(parsed.token.address);
      } else if (parsed.amount !== undefined) {
        // A native EIP-681 link always means the chain's own coin.
        setAssetId(NATIVE_ASSET);
      }
      if (parsed.amount !== undefined) {
        const decimals = parsed.token ? parsed.token.decimals : native.decimals;
        setAmount(formatUnits(parsed.amount, decimals));
      }
      setTo(parsed.address);
      setReview(null);
      setSubmission(null);
      setError(null);
      setScanError(null);
      setIsBusy(false);
      setScannerOpen(false);
      reviewRequestId.current += 1;
    } catch (caught) {
      // Keep the scanner open so the user can simply try another code.
      setScanError(describeRecipientError(caught));
    }
  }

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

      let parsedRecipient: ReturnType<typeof resolveRecipient>;
      try {
        parsedRecipient = resolveRecipient(to);
      } catch (caught) {
        throw new Error(describeRecipientError(caught));
      }
      if (
        parsedRecipient.token &&
        parsedRecipient.token.address.toLowerCase() !==
          selectedToken?.address.toLowerCase()
      ) {
        throw new Error(
          `This payment link is for ${parsedRecipient.token.symbol}. Select it in the Asset field, then review the transfer.`,
        );
      }

      const recipient = parsedRecipient.address;
      const value = selectedToken
        ? parseUnits(amount, selectedToken.decimals)
        : parseUnits(amount, native.decimals);
      if (
        parsedRecipient.amount !== undefined &&
        parsedRecipient.amount !== value
      ) {
        const decimals = selectedToken
          ? selectedToken.decimals
          : native.decimals;
        const symbol = selectedToken ? selectedToken.symbol : native.symbol;
        throw new Error(
          `This payment link requests ${formatUnits(parsedRecipient.amount, decimals)} ${symbol}. Enter that amount or scan the code again.`,
        );
      }
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
          on {chain.name}. Check the recipient and the maximum network fee before
          confirming.
        </p>
      </section>

      <section className="preview-card" aria-label="Send">
        <form className="send-fields" onSubmit={reviewTransfer}>
          <p className="muted-copy send-account">
            <span>Sending from</span>
            {selectedAddress ? (
              <>
                <code title={selectedAddress}>
                  {truncateAddress(selectedAddress)}
                </code>
                <CopyButton label="your address" value={selectedAddress} />
              </>
            ) : (
              <span>locked wallet</span>
            )}
          </p>
          <label>
            Asset
            <select
              disabled={isBusy}
              id="send-asset"
              onChange={(event) => {
                reviewRequestId.current += 1;
                setAssetId(event.target.value);
                setScanError(null);
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
            <span className="recipient-field">
              <textarea
                aria-label="Recipient address"
                autoComplete="off"
                disabled={isBusy}
                onChange={(event) => {
                  reviewRequestId.current += 1;
                  // Addresses and payment links are single-line values; a
                  // stray line break from the keyboard must not end up in one.
                  setTo(event.target.value.replace(/[\r\n]+/g, ""));
                  setScanError(null);
                  setReview(null);
                  setIsBusy(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="0x... or payment link"
                ref={recipientInputRef}
                required
                rows={1}
                spellCheck={false}
                value={to}
              />
              <button
                aria-label="Scan recipient QR code"
                className="recipient-scan-button"
                disabled={isBusy}
                onClick={() => {
                  setScanError(null);
                  setScannerOpen(true);
                }}
                title="Scan recipient QR code"
                type="button"
              >
                <ScanIcon />
                <span className="recipient-scan-label">Scan</span>
              </button>
            </span>
            <span className="field-help">
              Type or paste an address, or scan a wallet QR code. Payment links
              fill in the amount and token for you.
            </span>
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
                <dt>Gas limit</dt>
                <dd>{review.estimate.gas.toString()}</dd>
              </div>
              <div>
                <dt>Max fee per gas</dt>
                <dd>{formatGwei(review.estimate.maxFeePerGas)} gwei</dd>
              </div>
              <div>
                <dt>Priority fee</dt>
                <dd>
                  {formatGwei(review.estimate.maxPriorityFeePerGas)} gwei
                </dd>
              </div>
              <div>
                <dt>Maximum network fee</dt>
                <dd>
                  {formatUnits(review.estimate.maxTotalFee, native.decimals)}{" "}
                  {native.symbol}
                </dd>
              </div>
              {!review.token ? (
                <div>
                  <dt>Maximum total</dt>
                  <dd>
                    {formatUnits(
                      review.value + review.estimate.maxTotalFee,
                      native.decimals,
                    )}{" "}
                    {native.symbol}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="field-help">
              You may pay less than the maximum. The maximum is charged only if
              the base fee rises to the limit shown.
            </p>
            {isUnusuallyHighFee(review.estimate) ? (
              <p className="fee-warning" role="status">
                <strong>Unusually high network fee.</strong> Check the fee
                breakdown before confirming.
              </p>
            ) : null}
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

      {scannerOpen ? (
        <QrScannerDialog
          errorMessage={scanError}
          onClose={() => {
            setScannerOpen(false);
            setScanError(null);
          }}
          onScan={handleScan}
        />
      ) : null}
    </main>
  );
}

/** Viewfinder corners plus a scan line, matching the menu icon style. */
function ScanIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <path d="M2 5.5V4a2 2 0 0 1 2-2h1.5M10.5 2H12a2 2 0 0 1 2 2v1.5M14 10.5V12a2 2 0 0 1-2 2h-1.5M5.5 14H4a2 2 0 0 1-2-2v-1.5" />
      <path d="M2 8h12" />
    </svg>
  );
}
