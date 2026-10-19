export const THEME_STORAGE_KEY = "wallet_theme_v1";
export const THEME_ATTRIBUTE = "data-theme";

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = "light" | "dark";

/** Narrows an unknown stored value (or user input) to a supported mode. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

/** Turns the user's choice into the theme actually rendered on the page. */
export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}
