"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { Hex } from "viem";
import { CopyButton } from "@/components/copy-button";
import { clearClipboard } from "@/lib/clipboard";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

/** Placeholder shown while the key is masked; length matches a 32-byte key. */
const MASKED_KEY = "•".repeat(66);

/**
 * Two-step private-key screen. The wallet session is already unlocked, but the
 * password is re-verified against the encrypted vault before the key is shown:
 * an unlocked tab left unattended must not be enough to read a key out.
 *
 * The revealed key lives only in this component's state. It is masked by
 * default, dropped when the page unmounts, and once copied the screen reminds
 * the user that the secret is still sitting on the clipboard.
 *
 * The index is read on the client with `useParams` so the page itself stays
 * prerenderable.
 */
export function RevealPrivateKey() {
  const params = useParams<{ index: string }>();
  const index = Number(params?.index);
  const { chain } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const account = Number.isInteger(index)
    ? walletState.accounts.find((candidate) => candidate.index === index)
    : undefined;

  const [privateKey, setPrivateKey] = useState<Hex | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clipboardState, setClipboardState] = useState<
    "idle" | "warning" | "cleared"
  >("idle");

  if (!account) {
    return (
      <main className="page-main">
        <section className="page-heading">
          <p className="eyebrow">{chain.name} wallet</p>
          <h1>Account not found</h1>
          <p>This account is not part of the current wallet session.</p>
        </section>
        <Link className="text-link back-link" href="/accounts">
          Back to manage accounts
        </Link>
      </main>
    );
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      const key = await walletService.revealPrivateKey(index, password);
      setPassword("");
      setShowPassword(false);
      setIsKeyVisible(false);
      setPrivateKey(key);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not unlock the private key. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClearClipboard() {
    try {
      await clearClipboard();
      setClipboardState("cleared");
    } catch {
      // Leave the warning up: the secret is still on the clipboard.
    }
  }

  const backHref = `/accounts/${account.index}`;
  const mainClassName =
    clipboardState === "idle"
      ? "page-main"
      : "page-main page-main-with-notice";

  if (!privateKey) {
    return (
      <main className="page-main">
        <section
          className="form-card"
          aria-labelledby="reveal-private-key-title"
        >
          <p className="eyebrow">{account.name}</p>
          <h1 id="reveal-private-key-title">Reveal private key</h1>
          <p className="muted-copy">
            Enter your wallet password to unlock this account&apos;s private
            key.
          </p>
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
                  <EyeIcon crossed={showPassword} />
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
              <Link className="text-link" href={backHref}>
                Back
              </Link>
            </div>
          </form>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className={mainClassName}>
      <section className="security-warning" role="alert">
        <strong>Never share your private key.</strong> Anyone who has it gains
        full control of this account and can move all of its assets. No one —
        including this app — will ever ask you for it.
      </section>

      <section
        className="preview-card private-key-card"
        aria-labelledby="private-key-heading"
      >
        <div className="private-key-address">
          <p className="eyebrow">{account.name} address</p>
          <div className="address-line">
            <code title={account.address}>{account.address}</code>
            <CopyButton
              label={`${account.name} address`}
              value={account.address}
            />
          </div>
        </div>

        <h2 className="private-key-heading" id="private-key-heading">
          Private key
        </h2>
        <p className="private-key-caution">
          Make sure no one is watching your screen.
        </p>

        <div className="private-key-value-row">
          <code
            aria-hidden={!isKeyVisible}
            className="private-key-value"
            data-masked={!isKeyVisible}
            title={isKeyVisible ? privateKey : undefined}
          >
            {isKeyVisible ? privateKey : MASKED_KEY}
          </code>
        </div>

        <div className="private-key-actions">
          <button
            aria-label={isKeyVisible ? "Hide private key" : "Reveal private key"}
            aria-pressed={isKeyVisible}
            className="button button-outline"
            onClick={() => setIsKeyVisible((visible) => !visible)}
            type="button"
          >
            <EyeIcon crossed={isKeyVisible} />
            {isKeyVisible ? "Hide" : "Tap to reveal"}
          </button>
          <span className="private-key-copy">
            <CopyButton
              label="your private key"
              onCopy={() => setClipboardState("warning")}
              value={privateKey}
            />
            <span>Copy</span>
          </span>
        </div>
      </section>

      <Link className="text-link back-link" href={backHref}>
        Back to account
      </Link>

      {clipboardState !== "idle" ? (
        <div className="clipboard-notice" role="status">
          {clipboardState === "warning" ? (
            <>
              <span>The sensitive information remains on your clipboard.</span>
              <button
                className="button button-outline"
                onClick={() => void handleClearClipboard()}
                type="button"
              >
                Clear clipboard
              </button>
            </>
          ) : (
            <span>Clipboard cleared.</span>
          )}
        </div>
      ) : null}
    </main>
  );
}

/** Eye icon that draws a slash when `crossed`, matching the password field. */
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
