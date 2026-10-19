"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { walletService } from "@/services/wallet-service";
import { PasswordInput } from "@/components/password-input";

export function UnlockWalletForm() {
  const router = useRouter();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const wallets = walletState.wallets;
  const selectedWallet = wallets.find(
    (wallet) => wallet.id === walletState.selectedWalletId,
  );
  // Group the picker the same way the home manager does. A legend only helps
  // when more than one group is present.
  const walletGroups = [
    {
      label: "Wallets",
      wallets: wallets.filter((wallet) => wallet.kind !== "privateKey"),
    },
    {
      label: "Imported accounts",
      wallets: wallets.filter((wallet) => wallet.kind === "privateKey"),
    },
  ].filter((group) => group.wallets.length > 0);

  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);

  // Load the registry. It is public metadata, so it can be read while locked.
  useEffect(() => {
    let active = true;
    void walletService
      .refreshWallets()
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsRegistryLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Once the registry has loaded, a device with no wallets has nothing to
  // unlock: send the user back to the manager.
  useEffect(() => {
    if (isRegistryLoaded && wallets.length === 0) {
      router.replace("/");
    }
  }, [isRegistryLoaded, wallets.length, router]);

  // Probe biometric availability for the currently selected wallet. A passkey
  // enrollment is per wallet, so switching wallets re-checks it.
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
        } else if (!cancelled) {
          setBiometricLabel(null);
        }
      } catch {
        if (!cancelled) setBiometricLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletState.selectedWalletId]);

  async function handleWalletChange(walletId: string) {
    setError(null);
    setPassword("");
    setBiometricLabel(null);
    try {
      await walletService.selectWallet(walletId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not switch wallets.",
      );
    }
  }

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
      <h1 id="unlock-title">
        {selectedWallet ? `Unlock ${selectedWallet.name}` : "Unlock your wallet"}
      </h1>
      <p className="muted-copy">
        Enter the password you chose for this wallet on this device.
      </p>

      {wallets.length > 1 ? (
        <div className="account-controls">
          <label htmlFor="unlock-wallet">Wallet</label>
          <select
            id="unlock-wallet"
            onChange={(event) => void handleWalletChange(event.target.value)}
            value={walletState.selectedWalletId ?? ""}
          >
            {walletGroups.length > 1
              ? walletGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.wallets.map((wallet) => (
                      <option key={wallet.id} value={wallet.id}>
                        {wallet.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              : walletGroups[0]?.wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
          </select>
        </div>
      ) : null}

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
          <PasswordInput
            aria-label="Password"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
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

/** Best-effort label for the platform authenticator; falls back to a generic one. */
function getBiometricLabel(): string {
  if (typeof navigator === "undefined") return "biometric unlock";
  const userAgent = navigator.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "Face ID";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Touch ID";
  return "biometric unlock";
}
