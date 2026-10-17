/**
 * Shared URL safety helpers.
 *
 * NFT metadata and locally stored image links are untrusted public content, so
 * every layer (metadata parsing, storage validation) must agree on the exact
 * same rules. Keep this module the single source of truth: a URL that passes
 * `readNftMetadata` must also pass `parseStoredNfts`, otherwise adding an NFT
 * would fail only when the account metadata is persisted.
 */

/**
 * Upper bound for a stored image link. Inline `data:` images are legitimate
 * (on-chain art, Uniswap V3 positions), so the cap has to accommodate a
 * reasonably sized SVG/JSON payload while still protecting localStorage.
 */
export const MAX_IMAGE_URL_LENGTH = 128 * 1024;

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const ARWEAVE_GATEWAY = "https://arweave.net/";
const MAX_URI_LENGTH = 4096;
const SCHEME_LESS_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(?:\/|$|\?|#)/i;

export function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    // Any IPv6 literal is rejected outright; NFT metadata never needs one.
    normalized.includes(":") ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(normalized) ||
    /^0\./.test(normalized)
  );
}

/**
 * Returns the parsed URL when `value` is a safe public HTTPS URL, or null.
 * `base` resolves relative references (for example an NFT `image` field that
 * points at a sibling file of the metadata document).
 */
export function parseSafeRemoteUrl(
  value: string,
  base?: string | null,
): URL | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URI_LENGTH) return null;
  if (trimmed.includes("\\")) return null;

  let url: URL;
  try {
    url = new URL(trimmed, base ?? undefined);
  } catch {
    // Some contracts (for example the ENS NameWrapper) return a bare host and
    // path without a scheme. Assume the intended scheme is HTTPS.
    if (base || !SCHEME_LESS_HOST.test(trimmed)) return null;
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isPrivateHostname(url.hostname)
  ) {
    return null;
  }
  return url;
}

export interface InlineDataUri {
  mediaType: string;
  payload: string;
  isBase64: boolean;
}

/**
 * Parses the `data:` URI prologue. Returns null when `value` is not a data URI.
 * The payload itself is returned verbatim; callers decide how to decode it and
 * how large it may be.
 */
export function parseInlineDataUri(value: string): InlineDataUri | null {
  const trimmed = value.trim();
  if (!/^data:/i.test(trimmed)) return null;
  const separator = trimmed.indexOf(",");
  if (separator === -1) return null;
  const meta = trimmed.slice("data:".length, separator);
  const payload = trimmed.slice(separator + 1);
  const isBase64 = /;base64$/i.test(meta);
  const mediaType = (isBase64 ? meta.slice(0, -";base64".length) : meta)
    .split(";")[0]!
    .trim()
    .toLowerCase();
  return {
    mediaType: mediaType === "" ? "text/plain" : mediaType,
    payload,
    isBase64,
  };
}

export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

/**
 * An image link is either an inline `data:image/*` URI or a safe public HTTPS
 * URL. Anything else is unsupported and stored as `null`.
 */
export function isSafeImageUri(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IMAGE_URL_LENGTH) return false;
  const inline = parseInlineDataUri(trimmed);
  if (inline) return isImageMediaType(inline.mediaType);
  return parseSafeRemoteUrl(trimmed) !== null;
}

export function ipfsGatewayUrl(cidPath: string): string {
  return `${IPFS_GATEWAY}${cidPath}`;
}

export function arweaveGatewayUrl(path: string): string {
  return `${ARWEAVE_GATEWAY}${path}`;
}
