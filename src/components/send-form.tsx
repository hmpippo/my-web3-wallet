"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  type Address,
  type Hash,
} from "viem";
import { CHAIN } from "@/core/chain";
import { estimateNativeTransfer } from "@/services/transaction-service";
import { walletService } from "@/services/wallet-service";

interface TransferReview {
  to: Address;
  value: bigint;
  estimatedFee: bigint;
}

export function SendForm() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<TransferReview | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setReview(null);
    setTransactionHash(null);
    setIsBusy(true);

    try {
      const from = walletService.getAddress();
      if (!from) throw new Error("Wallet is locked. Unlock it to continue.");
      if (!isAddress(to)) {
        throw new TypeError("Recipient address is invalid");
      }

      const value = parseEther(amount);
      const recipient = getAddress(to);
      const estimate = await estimateNativeTransfer({
        from,
        to: recipient,
        value,
      });
      setReview({ to: recipient, value, estimatedFee: estimate.estimatedFee });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to prepare this transaction.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmTransfer() {
    if (!review) return;
    setError(null);
    setIsBusy(true);
    try {
      const hash = await walletService.signAndSendTransaction({
        to: review.to,
        value: review.value,
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
      setIsBusy(false);
    }
  }

  return (
    <main className="page-main">
      <section className="page-heading">
        <p className="eyebrow">Sepolia testnet</p>
        <h1>Send ETH</h1>
        <p>Check the recipient and estimated network fee before confirming.</p>
      </section>

      <section className="preview-card" aria-label="Send ETH">
        <form className="send-fields" onSubmit={reviewTransfer}>
          <label>
            Recipient address
            <input
              autoComplete="off"
              onChange={(event) => {
                setTo(event.target.value);
                setReview(null);
              }}
              placeholder="0x..."
              required
              spellCheck={false}
              value={to}
            />
          </label>
          <label>
            Amount (ETH)
            <input
              inputMode="decimal"
              onChange={(event) => {
                setAmount(event.target.value);
                setReview(null);
              }}
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
                <dt>To</dt>
                <dd>{review.to}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{formatEther(review.value)} ETH</dd>
              </div>
              <div>
                <dt>Estimated network fee</dt>
                <dd>{formatEther(review.estimatedFee)} ETH</dd>
              </div>
              <div>
                <dt>Estimated total</dt>
                <dd>
                  {formatEther(review.value + review.estimatedFee)} ETH
                </dd>
              </div>
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
