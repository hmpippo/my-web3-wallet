import {
  DEFAULT_THEME_MODE,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

export interface ThemeState {
  readonly mode: ThemeMode;
  readonly resolved: ResolvedTheme;
}

type ThemeListener = () => void;

/**
 * The theme rendered while server-rendering and during hydration.
 *
 * `localStorage` is unavailable on the server, so the markup always starts with
 * the default dark theme. React then re-renders with the stored preference
 * after hydration; returning the client value here would cause a hydration
 * mismatch. The inline `ThemeScript` has already applied the stored theme to
 * <html> before that, so the page never flashes the wrong palette.
 */
const SERVER_STATE: ThemeState = Object.freeze({
  mode: DEFAULT_THEME_MODE,
  resolved: resolveTheme(DEFAULT_THEME_MODE, false),
});

export function getServerThemeState(): ThemeState {
  return SERVER_STATE;
}

/**
 * Holds the light/dark/system preference.
 *
 * Like `chainService`, this is a small external store consumed through
 * `useSyncExternalStore`. The preference is a UI setting only; it is kept out
 * of the wallet vault and survives locking. In system mode the service tracks
 * `prefers-color-scheme`, and a `storage` listener keeps other tabs in sync.
 */
export class ThemeService {
  private state: ThemeState = SERVER_STATE;
  private readonly listeners = new Set<ThemeListener>();
  private readonly storageKey: string;
  private mediaQuery: MediaQueryList | null = null;
  private initialized = false;

  constructor(storageKey: string = THEME_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  getState = (): ThemeState => this.state;

  subscribe = (listener: ThemeListener): (() => void) => {
    this.init();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reads the stored preference and starts following the OS in system mode. */
  init(): void {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;

    this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.mediaQuery.addEventListener("change", this.handleSystemChange);
    window.addEventListener("storage", this.handleStorage);
    this.applyMode(readStoredMode(this.storageKey));
  }

  /** Stores and applies a new preference. */
  setMode(mode: ThemeMode): void {
    this.init();
    if (this.state.mode === mode) return;
    writeStoredMode(this.storageKey, mode);
    this.applyMode(mode);
  }

  private applyMode(mode: ThemeMode): void {
    const resolved = resolveTheme(mode, this.prefersDark());
    const changed =
      mode !== this.state.mode || resolved !== this.state.resolved;
    this.state = Object.freeze({ mode, resolved });
    this.writeDocument(resolved);
    if (changed) {
      for (const listener of this.listeners) listener();
    }
  }

  private writeDocument(resolved: ResolvedTheme): void {
    const root = document.documentElement;
    root.setAttribute(THEME_ATTRIBUTE, resolved);
    root.style.colorScheme = resolved;
  }

  private prefersDark(): boolean {
    return this.mediaQuery?.matches ?? false;
  }

  private handleSystemChange = (): void => {
    if (this.state.mode !== "system") return;
    this.applyMode("system");
  };

  private handleStorage = (event: StorageEvent): void => {
    if (event.key !== this.storageKey) return;
    const mode = readStoredMode(this.storageKey);
    if (mode !== this.state.mode) this.applyMode(mode);
  };
}

function readStoredMode(storageKey: string): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  try {
    const serialized = window.localStorage.getItem(storageKey);
    if (serialized === null) return DEFAULT_THEME_MODE;
    const parsed: unknown = JSON.parse(serialized);
    return isThemeMode(parsed) ? parsed : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

function writeStoredMode(storageKey: string, mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(mode));
  } catch {
    // Best effort: a blocked or full localStorage must not break the toggle.
  }
}

export const themeService = new ThemeService();

// The client bundle evaluates this module before hydration. Applying the stored
// preference here also keeps React's first client snapshot in sync with the
// attribute the inline script already wrote.
if (typeof window !== "undefined") {
  themeService.init();
}
