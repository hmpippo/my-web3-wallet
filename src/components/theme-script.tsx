import Script from "next/script";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Applies the stored theme before the first paint.
 *
 * `beforeInteractive` places the script in the initial HTML ahead of the app
 * bundle, so a dark-mode user never sees a light flash while React hydrates.
 * It deliberately duplicates the small storage read in `themeService` to stay
 * dependency-free.
 */
export function ThemeScript() {
  const script = `
(function () {
  var mode = "system";
  try {
    var raw = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (raw !== null) {
      var stored = JSON.parse(raw);
      if (stored === "light" || stored === "dark" || stored === "system") {
        mode = stored;
      }
    }
  } catch (error) {
    /* Blocked or corrupt storage falls back to the system preference. */
  }
  var dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)}, dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
})();
`;

  return (
    // App Router root layouts are the documented home for beforeInteractive
    // scripts; the lint rule only knows about the legacy pages/_document.js.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script
      dangerouslySetInnerHTML={{ __html: script }}
      id="theme-init"
      strategy="beforeInteractive"
    />
  );
}
