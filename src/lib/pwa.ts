/**
 * Platform checks for the install card. Kept as pure functions so the
 * user-agent edge cases can be tested without a browser.
 */

/**
 * iPadOS 13+ reports a desktop "MacIntel" user agent but still has touch
 * points, so the user-agent check alone would miss iPads.
 */
export function isIosDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

/**
 * `display-mode` is the modern check. `navigator.standalone` remains the
 * reliable fallback on older iOS versions.
 */
export function isStandaloneDisplayMode(
  displayModeMatches: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return displayModeMatches || navigatorStandalone === true;
}

/**
 * Safari is the only browser whose macOS web app currently uses a separate
 * website-data container. Chromium browsers share their normal profile, so
 * their install card should not claim otherwise.
 */
export function isSafariBrowser(userAgent: string): boolean {
  return (
    /Safari/.test(userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent)
  );
}
