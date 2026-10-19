"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";
import { PasswordInput } from "@/components/password-input";

export function CreateWalletForm() {
  const router = useRouter();
  const creationCompleted = useRef(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (!creationCompleted.current) walletService.lock();
    },
    [],
  );

  async function prepareWallet() {
    setError(null);
    setIsBusy(true);
    try {
      const prepared = await walletService.prepareWallet();
      setMnemonic(prepared.mnemonic);
      setAddress(prepared.address);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await walletService.createWallet(password, backupConfirmed);
      creationCompleted.current = true;
      router.replace("/wallet");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="form-card" aria-labelledby="create-title">
      <p className="eyebrow">New wallet</p>
      <h1 id="create-title">
        {mnemonic ? "Back up your recovery phrase" : "Create your wallet"}
      </h1>
      <p className="muted-copy">
        {mnemonic
          ? "Write these words down in order and keep them somewhere private. Anyone with this phrase can control this wallet."
          : "Your recovery phrase is the only way to restore access if you forget your password."}
      </p>

      {!mnemonic ? (
        <div className="form-actions">
          <button
            className="button button-primary"
            disabled={isBusy}
            onClick={prepareWallet}
            type="button"
          >
            {isBusy ? "Preparing..." : "Generate recovery phrase"}
          </button>
          <Link className="text-link" href="/">
            Back
          </Link>
        </div>
      ) : (
        <form className="wallet-form" onSubmit={confirmBackup}>
          <ol className="mnemonic-grid" aria-label="Recovery phrase">
            {mnemonic.split(" ").map((word, index) => (
              <li key={`${index}-${word}`}>
                <span>{index + 1}</span>
                <strong>{word}</strong>
              </li>
            ))}
          </ol>
          <label className="checkbox-row">
            <input
              checked={backupConfirmed}
              onChange={(event) => setBackupConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>I have safely backed up my recovery phrase.</span>
          </label>
          <label className="form-field">
            Password
            <PasswordInput
              aria-label="Password"
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
            <span className="field-help">Use at least 8 characters.</span>
          </label>
          <label className="form-field">
            Confirm password
            <PasswordInput
              aria-label="Confirm password"
              autoComplete="new-password"
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
              value={passwordConfirmation}
            />
          </label>
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={isBusy || !backupConfirmed}
              type="submit"
            >
              {isBusy ? "Creating wallet..." : "I backed it up — continue"}
            </button>
            <button
              className="text-button"
              disabled={isBusy}
              onClick={() => {
                walletService.lock();
                setMnemonic(null);
                setAddress(null);
                setPassword("");
                setPasswordConfirmation("");
                setBackupConfirmed(false);
              }}
              type="button"
            >
              Discard phrase
            </button>
          </div>
          {address && <p className="field-help">Wallet address: {address}</p>}
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Wallet setup failed. Please try again.";
}
