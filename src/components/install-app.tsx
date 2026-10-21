"use client";

import { useState, useSyncExternalStore } from "react";
import {
  getInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/install-prompt";
import {
  isIosDevice,
  isSafariBrowser,
  isStandaloneDisplayMode,
} from "@/lib/pwa";

type InstallMessage = "accepted" | "dismissed" | "unavailable" | null;

interface InstallAppProps {
  /**
   * Home appears before wallet creation; settings appears after the user has
   * already created or imported a wallet on this device.
   */
  context?: "home" | "settings";
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeDisplayMode(listener: () => void): () => void {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getDisplayModeSnapshot(): boolean {
  return isStandaloneDisplayMode(
    window.matchMedia("(display-mode: standalone)").matches,
    (navigator as Navigator & { standalone?: boolean }).standalone,
  );
}

function getIosSnapshot(): boolean {
  return isIosDevice(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  );
}

function getSafariSnapshot(): boolean {
  return isSafariBrowser(navigator.userAgent);
}

/**
 * Install guidance shown before the wallet is created. On Apple platforms this
 * warning is important: the installed web app can have a different storage
 * container from the browser tab, so the wallet must be created inside the
 * installed app.
 */
export function InstallApp({ context = "home" }: InstallAppProps) {
  const isSettings = context === "settings";
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<InstallMessage>(null);
  const isClient = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isStandalone = useSyncExternalStore(
    subscribeDisplayMode,
    getDisplayModeSnapshot,
    getServerSnapshot,
  );
  const isIos = useSyncExternalStore(
    subscribeNoop,
    getIosSnapshot,
    getServerSnapshot,
  );
  const isSafari = useSyncExternalStore(
    subscribeNoop,
    getSafariSnapshot,
    getServerSnapshot,
  );
  const installPrompt = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPrompt,
    () => null,
  );

  if (!isClient || isStandalone) return null;

  async function install() {
    setIsBusy(true);
    setMessage(null);
    try {
      setMessage(await promptInstall());
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="install-card" aria-labelledby="install-title">
      <div className="install-copy">
        <p className="eyebrow">Install</p>
        <h2 id="install-title">Use My Wallet as an app</h2>
        <p className="muted-copy">
          Add it to your Home Screen or Dock for a full-screen window and a
          dedicated app icon.
        </p>
        {isIos || isSafari ? (
          <p className="install-warning">
            {isSettings ? (
              <>
                This wallet is already on this device. On Apple platforms, an
                installed Home Screen or Safari web app can keep separate local
                storage from the browser, so this wallet may not appear there.
                Back up your recovery phrase or private key, then import it in
                the installed app.
              </>
            ) : (
              <>
                Install first, then create or import your wallet inside the
                installed app. On Apple platforms, an installed Home Screen or
                Safari web app can keep separate local storage from the browser,
                so a wallet created in Safari may not appear there. If you
                already have a wallet in Safari, make sure you have its recovery
                phrase before installing.
              </>
            )}
          </p>
        ) : isSettings ? null : (
          <p className="install-note">
            Install first, then create or import your wallet in the app.
          </p>
        )}
      </div>

      <div className="install-actions">
        {installPrompt ? (
          <button
            className="button button-primary"
            disabled={isBusy}
            onClick={() => void install()}
            type="button"
          >
            {isBusy ? "Opening..." : "Install app"}
          </button>
        ) : null}

        <details className="install-steps">
          <summary>
            {installPrompt ? "Other ways to install" : "How to install"}
          </summary>
          {isIos ? (
            <ol>
              <li>Open this page in Safari.</li>
              <li>
                Tap the Share button, then choose <strong>Add to Home Screen</strong>.
              </li>
              <li>Open the new app and create or import your wallet there.</li>
            </ol>
          ) : (
            <ul>
              <li>Safari on macOS: choose <strong>File → Add to Dock</strong>.</li>
              <li>
                Chrome or Edge: use the install icon in the address bar, or the
                browser menu.
              </li>
              <li>Other browsers: look for “Install app” in the browser menu.</li>
            </ul>
          )}
        </details>

        {message ? (
          <p className="install-status" role="status">
            {message === "accepted"
              ? "Installation started. Open the new app from your Home Screen or Dock."
              : message === "dismissed"
                ? "Installation was cancelled."
                : "Use your browser’s install option to add this app."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
