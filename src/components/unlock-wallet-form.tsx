"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";

export function UnlockWalletForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await walletService.unlock(password);
      router.replace("/wallet");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Wallet unlock failed. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="form-card" aria-labelledby="unlock-title">
      <p className="eyebrow">Welcome back</p>
      <h1 id="unlock-title">Unlock your wallet</h1>
      <p className="muted-copy">
        Enter the password you chose for this device.
      </p>
      <form className="wallet-form" onSubmit={unlock}>
        <label className="form-field">
          Password
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <div className="form-actions">
          <button
            className="button button-primary"
            disabled={isBusy}
            type="submit"
          >
            {isBusy ? "Unlocking..." : "Unlock"}
          </button>
          <Link className="text-link" href="/">
            Back
          </Link>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
