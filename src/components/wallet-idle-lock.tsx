"use client";

import { useEffect } from "react";
import { createIdleLock } from "@/lib/idle-lock";
import { walletService } from "@/services/wallet-service";

/**
 * Events that represent real user input. Focus and visibility changes are
 * deliberately excluded: returning to a tab after a long absence should not
 * revive a session that already expired.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
] as const;

/**
 * Locks the wallet after 30 seconds without input. The deadline is absolute,
 * and `check()` runs when the tab becomes visible again because background
 * timers are throttled and a sleeping device may not fire them on time.
 */
export function WalletIdleLock() {
  useEffect(() => {
    const idle = createIdleLock({
      isActive: () => walletService.isUnlocked,
      onIdle: () => walletService.lock("inactivity"),
    });

    const noteActivity = () => idle.noteActivity();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") idle.check();
    };

    // Capture phase so scrolling inside a panel also counts, not just the page.
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, noteActivity, {
        capture: true,
        passive: true,
      });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Only react to lock/unlock transitions. Token or metadata updates also
    // notify subscribers, and re-arming on those would silently extend the
    // session without any user input.
    let wasUnlocked = walletService.isUnlocked;
    const unsubscribe = walletService.subscribe(() => {
      const isUnlocked = walletService.isUnlocked;
      if (isUnlocked === wasUnlocked) return;
      wasUnlocked = isUnlocked;
      if (isUnlocked) idle.start();
      else idle.stop();
    });

    // The service may already be unlocked when this mounts (client navigation).
    if (wasUnlocked) idle.start();

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, noteActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
      idle.stop();
    };
  }, []);

  return null;
}
