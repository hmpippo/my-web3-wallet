"use client";

import { useEffect } from "react";
import {
  captureInstallPrompt,
  clearInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/install-prompt";

const CACHE_PREFIX = "my-wallet-";

/**
 * Registers the PWA service worker and keeps a deferred Chromium install
 * prompt available to the UI. Development unregisters production workers so a
 * local build can never leave `next dev` serving stale cached assets.
 */
export function PwaRegister() {
  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      captureInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => clearInstallPrompt();

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (!("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    if (process.env.NODE_ENV !== "production") {
      void removeDevelopmentWorker();
      return () => {
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => {
        // The first page load happens before the worker is active. Ask it to
        // cache the current document and its boot assets so a later offline
        // launch has an app shell to start from.
        return navigator.serviceWorker.ready.then(() => {
          registration.active?.postMessage({
            type: "CACHE_URLS",
            urls: currentPageAssets(),
          });
        });
      })
      .catch(() => {
        // Installation still works; offline support is best effort.
      });

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}

function currentPageAssets(): string[] {
  const urls = new Set<string>([`${window.location.origin}${window.location.pathname}`]);

  for (const script of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    if (script.src) urls.add(script.src);
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href]',
  )) {
    if (link.href) urls.add(link.href);
  }

  return [...urls].filter((url) => {
    try {
      return new URL(url).origin === window.location.origin;
    } catch {
      return false;
    }
  });
}

async function removeDevelopmentWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  } catch {
    return;
  }

  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
  } catch {
    // Cache cleanup is best effort.
  }
}
