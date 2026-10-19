"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";

/**
 * Recovery-phrase import. The phrase is validated and encrypted on this device;
 * it is never persisted in plaintext. This is the only form on the import page,
 * which is dedicated to recovery phrases (private keys import elsewhere).
 */
export function MnemonicImportForm() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await walletService.importWallet(mnemonic, password);
      setMnemonic("");
      setPassword("");
      setPasswordConfirmation("");
      router.replace("/wallet");
    } catch (caught) {
      setError(getErrorMessage(caught, "Wallet import failed. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="form-card" aria-labelledby="import-title">
      <p className="eyebrow">Restore wallet</p>
      <h1 id="import-title">Import a wallet</h1>
      <p className="muted-copy">
        Your recovery phrase is processed on this device and saved only in
        encrypted form.
      </p>
      <form className="wallet-form" onSubmit={importWallet}>
        <label className="form-field">
          Recovery phrase
          <textarea
            autoComplete="off"
            onChange={(event) => setMnemonic(event.target.value)}
            placeholder="Enter your 12 or 24 words"
            required
            rows={4}
            spellCheck={false}
            value={mnemonic}
          />
        </label>
        <label className="form-field">
          Password
          <input
            autoComplete="new-password"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <span className="field-help">Use at least 8 characters.</span>
        </label>
        <label className="form-field">
          Confirm password
          <input
            autoComplete="new-password"
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            required
            type="password"
            value={passwordConfirmation}
          />
        </label>
        <div className="form-actions">
          <button
            className="button button-primary"
            disabled={isBusy}
            type="submit"
          >
            {isBusy ? "Importing..." : "Import wallet"}
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

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
