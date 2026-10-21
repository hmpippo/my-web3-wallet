"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";
import { InstallApp } from "@/components/install-app";
import { PasswordInput } from "@/components/password-input";

type BiometricStatus = "loading" | "unsupported" | "enabled" | "disabled";

export function BiometricUnlockSettings() {
  const [status, setStatus] = useState<BiometricStatus>("loading");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readStatus = useCallback(async (): Promise<BiometricStatus> => {
    const [supported, enrolled] = await Promise.all([
      walletService.isBiometricUnlockAvailable(),
      walletService.hasBiometricUnlock(),
    ]);
    return !supported ? "unsupported" : enrolled ? "enabled" : "disabled";
  }, []);

  useEffect(() => {
    void readStatus().then(
      (next) => setStatus(next),
      () => setStatus("unsupported"),
    );
  }, [readStatus]);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsBusy(true);
    try {
      await walletService.enableBiometricUnlock(password);
      setPassword("");
      setMessage("Biometric unlock is now enabled on this device.");
      setStatus(await readStatus());
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setMessage(null);
    setIsBusy(true);
    try {
      await walletService.disableBiometricUnlock();
      setMessage("Biometric unlock was turned off on this device.");
      setStatus(await readStatus());
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="page-main form-page">
      <InstallApp context="settings" />
      <section className="form-card" aria-labelledby="biometric-title">
        <p className="eyebrow">Security</p>
        <h1 id="biometric-title">Biometric unlock</h1>
        <p className="muted-copy">
          Unlock this device with Touch ID or Face ID instead of typing your
          password. Your password always keeps working as a backup.
        </p>

        {status === "loading" ? (
          <p className="muted-copy" role="status">
            Checking this device...
          </p>
        ) : null}

        {status === "unsupported" ? (
          <p className="field-help" role="status">
            Biometric unlock is not available in this browser. Open the wallet in
            Safari or Chrome on a device with a platform authenticator, over a
            secure (https or localhost) connection.
          </p>
        ) : null}

        {status === "enabled" ? (
          <div className="form-actions">
            <button
              className="button button-outline"
              disabled={isBusy}
              onClick={() => void disable()}
              type="button"
            >
              {isBusy ? "Turning off..." : "Turn off biometric unlock"}
            </button>
          </div>
        ) : null}

        {status === "disabled" ? (
          <form className="wallet-form" onSubmit={enable}>
            <label className="form-field">
              Confirm your password
              <PasswordInput
                aria-label="Confirm your password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                value={password}
              />
              <span className="field-help">
                Your password is only used to decrypt the recovery phrase for
                this device. It is never shared.
              </span>
            </label>
            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={isBusy}
                type="submit"
              >
                {isBusy ? "Enabling..." : "Enable biometric unlock"}
              </button>
            </div>
          </form>
        ) : null}

        {message ? (
          <p className="field-help" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <p className="field-help">
          A passkey is created for this wallet. On Apple devices it can sync with
          iCloud Keychain, so the same passkey is available on your other Apple
          devices. The encrypted wallet itself still has to be set up on each
          device with your password first.
        </p>
        <Link className="text-link back-link" href="/wallet">
          Back to wallet
        </Link>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Biometric unlock could not be updated. Please try again.";
}
