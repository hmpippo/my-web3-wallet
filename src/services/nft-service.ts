import type { Address } from "viem";
import { getAddress } from "viem";
import { publicClient } from "@/core/chain";
import type { NftStandard, StoredWalletNft } from "@/core/storage";

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

export interface NftServiceDependencies {
  readContract?: (params: {
    address: Address;
    abi: typeof NFT_ABI | typeof MULTI_TOKEN_ABI;
    functionName: "tokenURI" | "uri";
    args: readonly [bigint];
  }) => Promise<unknown>;
  fetch?: typeof fetch;
}

export interface NftIdentity {
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

export function resolveNftUri(uri: string): string {
  const normalized = uri.trim();
  if (normalized.startsWith("ipfs://")) {
    const path = normalized.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!path || path.startsWith("/") || path.includes("\\")) {
      throw new Error("The NFT metadata uses an invalid IPFS URI.");
    }
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
    return `https://ipfs.io/ipfs/${encodedPath}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("NFT metadata URI must use HTTPS or ipfs://.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isLocalHostname(url.hostname)
  ) {
    throw new Error("NFT metadata URI must be a public HTTPS or ipfs:// URL.");
  }
  return url.href;
}

export async function readNftMetadata(
  address: Address,
  tokenId: bigint,
  standard: NftStandard,
  dependencies: NftServiceDependencies = {},
): Promise<StoredWalletNft> {
  const readContract =
    dependencies.readContract ??
    ((params: Parameters<typeof publicClient.readContract>[0]) =>
      publicClient.readContract(params));
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
    const uri =
      standard === "ERC-1155"
        ? uriResult.replace(/\{id\}/g, tokenId.toString(16).padStart(64, "0"))
        : uriResult;
    const metadataUrl = resolveNftUri(uri);
    const metadata = await fetchNftJson(metadataUrl, requestFetch);
    return parseNftMetadata(metadata, {
      address,
      tokenId: tokenId.toString(),
      standard,
    });
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

async function fetchNftJson(
  url: string,
  requestFetch: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await requestFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
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

function parseNftMetadata(
  value: unknown,
  identity: NftIdentity,
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
  const image = record.image ?? record.image_url;
  if (image !== undefined && image !== null && typeof image !== "string") {
    throw new Error("NFT metadata image field must be a URI string.");
  }
  return {
    ...identity,
    name,
    description,
    imageUrl: typeof image === "string" ? resolveNftUri(image) : null,
  };
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.includes(":") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}
