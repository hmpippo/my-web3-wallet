"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { walletService } from "@/services/wallet-service";

export function UnlockWalletForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [enrolled, supported] = await Promise.all([
          walletService.hasBiometricUnlock(),
          walletService.isBiometricUnlockAvailable(),
        ]);
        if (!cancelled && enrolled && supported) {
          setBiometricLabel(getBiometricLabel());
        }
      } catch {
        // The biometric probe is best-effort; password unlock always works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlockWithBiometric() {
    setError(null);
    setIsBusy(true);
    try {
      await walletService.unlockWithBiometric();
      router.replace("/wallet");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message} Use your password instead.`
          : "Biometric unlock failed. Use your password instead.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await walletService.unlock(password);
      setPassword("");
      setShowPassword(false);
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

      {biometricLabel ? (
        <div className="biometric-unlock">
          <button
            className="button button-primary"
            disabled={isBusy}
            onClick={() => void unlockWithBiometric()}
            type="button"
          >
            {isBusy ? "Unlocking..." : `Unlock with ${biometricLabel}`}
          </button>
          <p className="field-help">
            Your password always keeps working as a backup.
          </p>
          <p className="form-divider" aria-hidden="true">
            or use your password
          </p>
        </div>
      ) : null}

      <form className="wallet-form" onSubmit={unlock}>
        <label className="form-field">
          Password
          <span className="password-input-wrapper">
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="password-visibility"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? (
                <svg
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11.5 11.5 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1.1-1.2 2.2-2.2 3.2M6.2 6.2C3.9 7.7 2.8 10 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </span>
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

/** Best-effort label for the platform authenticator; falls back to a generic one. */
function getBiometricLabel(): string {
  if (typeof navigator === "undefined") return "biometric unlock";
  const userAgent = navigator.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "Face ID";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Touch ID";
  return "biometric unlock";
}
