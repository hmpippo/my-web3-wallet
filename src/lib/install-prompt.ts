/**
 * A tiny external store for Chromium's deferred install prompt.
 *
 * The event is captured once by the global PWA registration component and
 * consumed later by the install card. Storing it outside React keeps the
 * listener alive even when no install UI is mounted.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function captureInstallPrompt(event: BeforeInstallPromptEvent): void {
  // Required or Chrome shows its own mini-infobar instead of our button.
  event.preventDefault();
  deferredPrompt = event;
  emit();
}

export function clearInstallPrompt(): void {
  if (deferredPrompt === null) return;
  deferredPrompt = null;
  emit();
}

function timeout(ms: number): Promise<null> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(null), ms);
  });
}

export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = deferredPrompt;
  if (event === null) return "unavailable";

  try {
    // A stale event can leave the browser prompt unresolved. Do not let the
    // install button stay disabled forever if the native UI never appears.
    const prompted = await Promise.race([
      event.prompt().then(() => true),
      timeout(5_000),
    ]);
    if (prompted !== true) {
      clearInstallPrompt();
      return "unavailable";
    }

    const choice = await Promise.race([event.userChoice, timeout(120_000)]);
    clearInstallPrompt();
    return choice?.outcome ?? "unavailable";
  } catch {
    clearInstallPrompt();
    return "unavailable";
  }
}
