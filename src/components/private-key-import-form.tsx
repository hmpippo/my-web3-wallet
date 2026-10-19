"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";
import { getErrorMessage } from "@/components/mnemonic-import-form";
import { PasswordInput } from "@/components/password-input";

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
          <PasswordInput
            aria-label="Private key"
            autoComplete="off"
            onChange={(event) => setPrivateKey(event.target.value)}
            placeholder="0x…"
            required
            revealLabel="private key"
            spellCheck={false}
            value={privateKey}
          />
          <span className="field-help">
            A 64-character hexadecimal key, with or without the 0x prefix.
          </span>
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
