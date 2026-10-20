import { isIP } from "node:net";
import { createRateLimiter } from "./rate-limit";

/**
 * Limits for the public transaction-history route.
 *
 * One browser page can request up to three upstream Etherscan sources per
 * call, so the per-address budget is deliberately below the per-IP budget: a
 * single client can browse at a reasonable pace, while an address sweep from
 * one host quickly runs into the IP limit.
 */
export const HISTORY_RATE_WINDOW_MS = 60_000;
export const HISTORY_IP_LIMIT = 30;
export const HISTORY_ADDRESS_LIMIT = 20;

export const historyIpLimiter = createRateLimiter({
  limit: HISTORY_IP_LIMIT,
  windowMs: HISTORY_RATE_WINDOW_MS,
});

export const historyAddressLimiter = createRateLimiter({
  limit: HISTORY_ADDRESS_LIMIT,
  windowMs: HISTORY_RATE_WINDOW_MS,
});

/** Test helper; there is no production caller. */
export function resetHistoryRateLimits(): void {
  historyIpLimiter.reset();
  historyAddressLimiter.reset();
}

/**
 * Best-effort client IP. On Vercel `x-forwarded-for` is set by the platform;
 * on a self-hosted server it can be spoofed, which the in-memory limiter
 * cannot prevent. Invalid values fall back to a shared bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && isIP(first) !== 0) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp) !== 0) return realIp;
  return "unknown";
}
