"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BiometricEnableDialog } from "@/components/biometric-enable-dialog";
import { ToggleSwitch } from "@/components/toggle-switch";
import { FingerprintIcon } from "@/components/wallet-icons";
import { walletService } from "@/services/wallet-service";

type BiometricStatus = "loading" | "unsupported" | "enabled" | "disabled";

/**
 * Compact biometrics switch for the wallet heading.
 *
 * Turning it on opens a confirmation dialog because enabling needs the wallet
 * password. Turning it off is immediate and never asks for one.
 */
export function BiometricToggle() {
  const [status, setStatus] = useState<BiometricStatus>("loading");
  const [isBusy, setIsBusy] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const switchRef = useRef<HTMLButtonElement>(null);

  const readStatus = useCallback(async (): Promise<BiometricStatus> => {
    const [supported, enrolled] = await Promise.all([
      walletService.isBiometricUnlockAvailable(),
      walletService.hasBiometricUnlock(),
    ]);
    return !supported ? "unsupported" : enrolled ? "enabled" : "disabled";
  }, []);

  useEffect(() => {
    let cancelled = false;

    void readStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus("unsupported");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [readStatus]);

  async function handleToggle(next: boolean) {
    setError(null);
    setNotice(null);

    if (next) {
      setIsDialogOpen(true);
      return;
    }

    setIsBusy(true);
    try {
      await walletService.disableBiometricUnlock();
      setStatus("disabled");
      setNotice("Biometric unlock turned off on this device.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  function handleEnabled() {
    setIsDialogOpen(false);
    setStatus("enabled");
    setNotice("Biometric unlock enabled on this device.");
  }

  const unavailable = status === "unsupported";

  return (
    <div className="biometric-toggle-group">
      <div className="biometric-toggle">
        <span className="biometric-toggle-icon">
          <FingerprintIcon />
        </span>
        <span className="biometric-toggle-label">Biometrics</span>
        <ToggleSwitch
          checked={status === "enabled"}
          disabled={status === "loading" || unavailable || isBusy}
          label="Biometric unlock"
          onChange={(next) => void handleToggle(next)}
          switchRef={switchRef}
        />
      </div>

      {unavailable ? (
        <span className="biometric-toggle-note">
          Not available in this browser.
        </span>
      ) : null}
      {error ? (
        <p className="biometric-toggle-error" role="alert">
          {error}
        </p>
      ) : null}
      <span aria-live="polite" className="sr-only" role="status">
        {notice ?? ""}
      </span>

      {isDialogOpen ? (
        <BiometricEnableDialog
          onClose={() => setIsDialogOpen(false)}
          onEnabled={handleEnabled}
          returnFocusRef={switchRef}
        />
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Biometric unlock could not be changed. Please try again.";
}
