import type { Address } from "viem";
import { getAddress } from "viem";
import { getPublicClient } from "@/core/chain";
import type { NftStandard, StoredWalletNft } from "@/core/storage";
import {
  isJsonMediaType,
  isSafeImageUri,
  MAX_IMAGE_URL_LENGTH,
  parseInlineDataUri,
  parseSafeRemoteUrl,
  type InlineDataUri,
} from "@/core/url-safety";

const MAX_TOKEN_ID = (BigInt("1") << BigInt("256")) - BigInt("1");
const MAX_METADATA_BYTES = 256 * 1024;
const NFT_ABI = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
const MULTI_TOKEN_ABI = [
  {
    type: "function",
    name: "uri",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
const NFT_OWNER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
const MULTI_TOKEN_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface NftReadRequest {
  address: Address;
  abi:
    | typeof NFT_ABI
    | typeof MULTI_TOKEN_ABI
    | typeof NFT_OWNER_ABI
    | typeof MULTI_TOKEN_BALANCE_ABI;
  functionName: "tokenURI" | "uri" | "ownerOf" | "balanceOf";
  args: readonly [bigint] | readonly [Address, bigint];
}

export interface NftServiceDependencies {
  readContract?: (params: NftReadRequest) => Promise<unknown>;
  fetch?: typeof fetch;
}

function resolveReadContract(
  dependencies: NftServiceDependencies,
  chainId: number,
): NonNullable<NftServiceDependencies["readContract"]> {
  return (
    dependencies.readContract ??
    ((params) =>
      getPublicClient(chainId).readContract(params as never) as Promise<unknown>)
  );
}

export interface NftIdentity {
  chainId: number;
  address: Address;
  tokenId: string;
  standard: NftStandard;
}

export function normalizeNftAddress(value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    throw new Error("Enter a valid NFT contract address.");
  }
  return getAddress(value.trim().toLowerCase());
}

export function parseNftTokenId(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized) || normalized.length > 78) {
    throw new Error("Enter a token ID as a non-negative decimal integer.");
  }
  const tokenId = BigInt(normalized);
  if (tokenId > MAX_TOKEN_ID) {
    throw new Error("Token ID must fit in an unsigned 256-bit integer.");
  }
  return tokenId;
}

/**
 * Replaces the ERC-1155 `{id}` placeholder (case-insensitive).
 *
 * The ERC-1155 metadata spec requires the lowercase, zero-padded 64-character
 * hex form. Some contracts, such as the ENS NameWrapper, use the `0x{id}`
 * template and expect the minimal hex form instead (`0x01`, not 64 zeroes),
 * so the padded form is only used when the template is not prefixed with `0x`.
 */
export function substituteTokenId(
  uri: string,
  tokenId: bigint,
  standard: NftStandard,
): string {
  if (standard !== "ERC-1155" || !/\{id\}/i.test(uri)) return uri;
  const padded = tokenId.toString(16).padStart(64, "0");
  const minimal = minimalHexTokenId(tokenId);
  return uri.replace(/\{id\}/gi, (_match, offset: number) => {
    const prefix = uri.slice(Math.max(0, offset - 2), offset).toLowerCase();
    return prefix === "0x" ? minimal : padded;
  });
}

/**
 * Resolves a token URI to a fetchable public URL.
 *
 * Supported shapes:
 * - `ipfs://<cid>/<path>` (also `ipfs://ipfs/<cid>/...`) via the public gateway
 * - `ar://<id>/<path>` (Arweave) via `https://arweave.net`
 * - absolute public HTTPS URLs, and scheme-less `host/path` values that real
 *   contracts return (for example the ENS NameWrapper metadata service)
 * - relative references when `base` (the metadata URL) is provided
 *
 * `data:` URIs are intentionally not handled here: they are inline metadata and
 * are decoded without a network request. See `readInlineMetadata`.
 */
export function resolveNftUri(uri: string, base?: string | null): string {
  const normalized = uri.trim();
  if (!normalized) {
    throw new Error("The NFT metadata uses an empty URI.");
  }

  const ipfs = parseIpfsUri(normalized);
  if (ipfs) return ipfs;

  const arweave = parseArweaveUri(normalized);
  if (arweave) return arweave;

  const url = parseSafeRemoteUrl(normalized, base);
  if (url) return url.href;

  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    throw new Error("NFT metadata URI must be a public HTTPS or ipfs:// URL, or an ar:// URI.");
  }
  throw new Error("NFT metadata URI must use HTTPS, ipfs://, or ar://.");
}

/**
 * Resolves an NFT `image` field. Inline `data:image/*` values are kept as-is
 * (the browser renders them without a request); everything else is resolved
 * like a metadata URI, relative to the metadata document when needed.
 */
export function resolveImageUri(
  value: string,
  metadataUrl: string | null,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("The NFT metadata image field is empty.");
  }
  if (parseInlineDataUri(normalized)) {
    if (!isSafeImageUri(normalized)) {
      throw new Error(
        "NFT metadata image must be an HTTPS URL or an inline image.",
      );
    }
    return normalized;
  }
  return resolveNftUri(normalized, metadataUrl);
}

export async function readNftMetadata(
  address: Address,
  tokenId: bigint,
  standard: NftStandard,
  chainId: number,
  dependencies: NftServiceDependencies = {},
): Promise<StoredWalletNft> {
  const readContract = resolveReadContract(dependencies, chainId);
  const requestFetch = dependencies.fetch ?? globalThis.fetch;
  try {
    const uriResult =
      standard === "ERC-721"
        ? await readContract({
            address,
            abi: NFT_ABI,
            functionName: "tokenURI",
            args: [tokenId],
          })
        : await readContract({
            address,
            abi: MULTI_TOKEN_ABI,
            functionName: "uri",
            args: [tokenId],
          });
    if (typeof uriResult !== "string" || uriResult.trim().length === 0) {
      throw new Error("The contract returned an empty metadata URI.");
    }
    const uri = substituteTokenId(uriResult.trim(), tokenId, standard);
    const inlineMetadata = readInlineMetadata(uri);
    let metadataUrl: string | null = null;
    let metadata: unknown;
    if (inlineMetadata !== null) {
      metadata = inlineMetadata;
    } else {
      metadataUrl = resolveNftUri(uri);
      metadata = await fetchNftJson(metadataUrl, requestFetch);
    }
    return parseNftMetadata(
      metadata,
      {
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
      },
      metadataUrl,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("NFT metadata could not be loaded.")
    ) {
      throw error;
    }
    throw new Error(
      `NFT metadata could not be loaded. Check the contract, token ID, and metadata availability, then retry. ${
        error instanceof Error ? error.message : ""
      }`.trim(),
    );
  }
}

/**
 * Reads whether `owner` currently holds `tokenId` of `address`.
 *
 * Returns `true` when the contract confirms the balance/owner, `false` when the
 * contract definitively answers that someone else holds it, and throws when the
 * answer cannot be determined (a reverting call, a bad response shape, or a
 * transport error).
 *
 * That three-way result is what lets callers pick opposite failure policies:
 * adding an NFT must fail closed (reject anything unproven), while pruning the
 * locally stored list must fail open (never delete an entry just because the
 * RPC was unreachable).
 */
export async function readNftOwnership(
  address: Address,
  tokenId: bigint,
  standard: NftStandard,
  owner: Address,
  chainId: number,
  dependencies: NftServiceDependencies = {},
): Promise<boolean> {
  const readContract = resolveReadContract(dependencies, chainId);
  if (standard === "ERC-721") {
    const tokenOwner = await readContract({
      address,
      abi: NFT_OWNER_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    });
    if (typeof tokenOwner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenOwner)) {
      throw new Error("The contract did not return a valid owner address.");
    }
    return getAddress(tokenOwner.toLowerCase()) === getAddress(owner.toLowerCase());
  }
  const balance = await readContract({
    address,
    abi: MULTI_TOKEN_BALANCE_ABI,
    functionName: "balanceOf",
    args: [owner, tokenId],
  });
  if (typeof balance !== "bigint") {
    throw new Error("The contract did not return a valid ERC-1155 balance.");
  }
  return balance > BigInt(0);
}

async function fetchNftJson(
  url: string,
  requestFetch: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await requestFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Gateways such as nftstorage.link redirect to another public gateway,
      // so redirects must be followed. CORS and the initial host checks remain
      // the guard rails: a redirect that leaves the public web cannot be read
      // cross-origin from the browser.
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("NFT metadata request failed (network or CORS error).");
  }
  if (!response.ok) {
    throw new Error(`NFT metadata server returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type");
  if (
    contentType &&
    !/^(application\/json|application\/[\w.-]+\+json)(?:\s*;|$)/i.test(
      contentType,
    )
  ) {
    throw new Error("NFT metadata response does not have a JSON content type.");
  }
  if (!response.body) {
    throw new Error("NFT metadata response body is unavailable.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
    throw new Error("NFT metadata exceeds the 256 KiB size limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_METADATA_BYTES) {
        await reader.cancel();
        throw new Error("NFT metadata exceeds the 256 KiB size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("NFT metadata response is not valid JSON.");
  }
}

/**
 * Decodes `data:application/json...` token URIs in place. Returns null when the
 * URI is not inline metadata, so the caller can fall back to fetching.
 */
function readInlineMetadata(uri: string): unknown | null {
  const inline = parseInlineDataUri(uri);
  if (!inline) return null;
  if (!isJsonMediaType(inline.mediaType)) {
    throw new Error("The inline NFT metadata is not JSON.");
  }
  const bytes = decodeInlinePayload(inline);
  if (bytes.byteLength > MAX_METADATA_BYTES) {
    throw new Error("NFT metadata exceeds the 256 KiB size limit.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("NFT metadata response is not valid UTF-8 JSON.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("NFT metadata response is not valid JSON.");
  }
}

function decodeInlinePayload(inline: InlineDataUri): Uint8Array {
  if (!inline.isBase64) {
    // JSON payloads use percent-encoding; `+` is not treated as a space
    // because `decodeURIComponent` does not decode it as one.
    let decoded: string;
    try {
      decoded = decodeURIComponent(inline.payload);
    } catch {
      decoded = inline.payload;
    }
    return new TextEncoder().encode(decoded);
  }
  const compact = inline.payload.replace(/\s+/g, "");
  // 4 base64 characters encode at most 3 bytes.
  if (compact.length > MAX_METADATA_BYTES * 2) {
    throw new Error("NFT metadata exceeds the 256 KiB size limit.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("NFT metadata response is not valid base64.");
  }
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new Error("NFT metadata response is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseNftMetadata(
  value: unknown,
  identity: NftIdentity,
  metadataUrl: string | null,
): StoredWalletNft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("NFT metadata JSON must be an object.");
  }
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : `${identity.standard} #${identity.tokenId}`;
  const description =
    typeof record.description === "string" ? record.description : "";
  if (name.length > 128 || description.length > 4000) {
    throw new Error("NFT metadata name or description exceeds the size limit.");
  }
  // `image_data` is only used when it already holds a URI; raw markup is not
  // rendered so that untrusted on-chain content never becomes stored HTML.
  const image = record.image ?? record.image_url ?? record.image_data;
  if (image !== undefined && image !== null && typeof image !== "string") {
    throw new Error("NFT metadata image field must be a URI string.");
  }
  return {
    ...identity,
    name,
    description,
    imageUrl: resolveOptionalImage(image, metadataUrl),
  };
}

/**
 * An unusable image never blocks the NFT: the entry still carries the verified
 * name and description, and the tile falls back to its placeholder.
 */
function resolveOptionalImage(
  image: unknown,
  metadataUrl: string | null,
): string | null {
  if (typeof image !== "string" || !image.trim()) return null;
  try {
    const resolved = resolveImageUri(image, metadataUrl);
    if (resolved.length > MAX_IMAGE_URL_LENGTH) return null;
    return isSafeImageUri(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function parseIpfsUri(value: string): string | null {
  if (!/^ipfs:\/\//i.test(value)) return null;
  const { path, suffix } = splitUriSuffix(value.slice("ipfs://".length));
  const cidPath = path.replace(/^ipfs\//i, "");
  if (!cidPath || cidPath.startsWith("/") || cidPath.includes("\\")) {
    throw new Error("The NFT metadata uses an invalid IPFS URI.");
  }
  const encoded = cidPath.split("/").map(encodePathSegment).join("/");
  return `https://ipfs.io/ipfs/${encoded}${suffix}`;
}

function parseArweaveUri(value: string): string | null {
  const match = /^(?:ar|arweave):\/\/(.+)$/i.exec(value);
  if (!match) return null;
  const rest = match[1]!.trim();
  if (!rest || rest.startsWith("/") || rest.includes("\\") || /\s/.test(rest)) {
    throw new Error("The NFT metadata uses an invalid Arweave URI.");
  }
  return `https://arweave.net/${rest}`;
}

function splitUriSuffix(value: string): { path: string; suffix: string } {
  const suffixIndex = value.search(/[?#]/);
  if (suffixIndex === -1) return { path: value, suffix: "" };
  return {
    path: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex),
  };
}

function encodePathSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return encodeURIComponent(decoded);
}

function minimalHexTokenId(tokenId: bigint): string {
  const hex = tokenId.toString(16);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}
