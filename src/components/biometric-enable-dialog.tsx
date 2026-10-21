"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { VaultDecryptionError } from "@/core/crypto";
import { PasswordInput } from "@/components/password-input";
import { walletService } from "@/services/wallet-service";
import { FingerprintIcon } from "@/components/wallet-icons";

interface BiometricEnableDialogProps {
  onClose: () => void;
  /** Called after the biometric vault has been stored successfully. */
  onEnabled: () => void;
  /** Focused again when the dialog closes, so keyboard users stay in place. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Confirmation dialog for turning biometric unlock on.
 *
 * Enabling creates a passkey, so it re-checks the wallet password first and
 * explains what is stored. Turning biometrics off never needs this dialog.
 */
export function BiometricEnableDialog({
  onClose,
  onEnabled,
  returnFocusRef,
}: BiometricEnableDialogProps) {
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Lock background scrolling while open, and put the cursor in the password
  // field. Focus is restored explicitly to the switch because a click can
  // otherwise leave focus on the switch after the dialog mounts.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    passwordRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onClose]);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      await walletService.enableBiometricUnlock(password);
      setPassword("");
      onEnabled();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className="biometric-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        aria-labelledby="biometric-dialog-title"
        aria-modal="true"
        className="biometric-dialog"
        role="dialog"
      >
        <div className="biometric-dialog-heading">
          <span className="biometric-dialog-icon">
            <FingerprintIcon />
          </span>
          <div>
            <h2 id="biometric-dialog-title">Enable biometric unlock</h2>
            <p>
              Use Touch ID or Face ID to unlock this wallet instead of typing
              your password.
            </p>
          </div>
        </div>

        <ul className="biometric-dialog-points">
          <li>Your password always keeps working as a backup.</li>
          <li>
            A passkey is created for this wallet. On Apple devices it can sync
            with iCloud Keychain.
          </li>
          <li>
            The encrypted wallet still has to be set up on each device with your
            password first.
          </li>
        </ul>

        <form className="wallet-form" onSubmit={enable}>
          <label className="form-field">
            Confirm your password
            <PasswordInput
              aria-label="Confirm your password"
              autoComplete="current-password"
              autoFocus
              inputRef={passwordRef}
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
            <span className="field-help">
              Your password is only used to decrypt the recovery phrase for this
              device. It is never shared.
            </span>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="form-actions">
            <button
              className="button button-outline"
              disabled={isBusy}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={isBusy || password.length === 0}
              type="submit"
            >
              {isBusy ? "Enabling..." : "Enable biometrics"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof VaultDecryptionError) {
    return "Incorrect password. Please try again.";
  }
  return error instanceof Error
    ? error.message
    : "Biometric unlock could not be enabled. Please try again.";
}
