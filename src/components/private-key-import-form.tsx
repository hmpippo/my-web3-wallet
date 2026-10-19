"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";
import { getErrorMessage } from "@/components/mnemonic-import-form";

/**
 * Imports a single private key as its own wallet.
 *
 * A raw key has no recovery phrase and no BIP-32 lineage, so unlike a mnemonic
 * it yields exactly one account that can never derive a second, and it cannot
 * be restored from a phrase if the device is lost. The section copy states that
 * plainly, and the key is normalized, validated, and address-derived before
 * anything is encrypted and stored.
 */
export function PrivateKeyImportForm() {
  const router = useRouter();
  const [privateKey, setPrivateKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importPrivateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await walletService.importPrivateKey(privateKey, password);
      setPrivateKey("");
      setPassword("");
      setPasswordConfirmation("");
      setShowKey(false);
      router.replace("/wallet");
    } catch (caught) {
      setError(
        getErrorMessage(caught, "Private-key import failed. Please try again."),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="form-card" aria-labelledby="import-private-key-title">
      <p className="eyebrow">Restore account</p>
      <h1 id="import-private-key-title">Import a private key</h1>
      <section className="security-warning" role="note">
        <strong>Importing a private key is different.</strong> It creates a
        single-account wallet with no recovery phrase: you cannot add more
        accounts to it, and if you lose the key or this device the funds are
        gone. Only import a key you control.
      </section>
      <form className="wallet-form" onSubmit={importPrivateKey}>
        <label className="form-field">
          Private key
          <span className="password-input-wrapper">
            <input
              autoComplete="off"
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="0x…"
              required
              spellCheck={false}
              type={showKey ? "text" : "password"}
              value={privateKey}
            />
            <button
              aria-label={showKey ? "Hide private key" : "Show private key"}
              aria-pressed={showKey}
              className="password-visibility"
              onClick={() => setShowKey((visible) => !visible)}
              type="button"
            >
              <EyeIcon crossed={showKey} />
            </button>
          </span>
          <span className="field-help">
            A 64-character hexadecimal key, with or without the 0x prefix.
          </span>
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
            {isBusy ? "Importing..." : "Import private key"}
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

/** Eye icon that draws a slash when `crossed`, matching the password fields. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {crossed ? (
        <path
          d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11.5 11.5 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1.1-1.2 2.2-2.2 3.2M6.2 6.2C3.9 7.7 2.8 10 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
