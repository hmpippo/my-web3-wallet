import type { EncryptedVault } from "./crypto";
import { accountDerivationPath } from "./hd-wallet";
import { isSafeImageUri, MAX_IMAGE_URL_LENGTH } from "./url-safety";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "./chain";
import { getAddress } from "viem";

export const VAULT_STORAGE_KEY = "wallet_vault_v1";
export const ACCOUNT_METADATA_STORAGE_KEY = "wallet_accounts_v1";

export interface StoredWalletAccount {
  readonly path: string;
  readonly name: string;
  readonly hidden: boolean;
  readonly tokens?: readonly StoredWalletToken[];
  readonly nfts?: readonly StoredWalletNft[];
}

export interface StoredWalletToken {
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly hidden: boolean;
}

export type NftStandard = "ERC-721" | "ERC-1155";

export interface StoredWalletNft {
  readonly chainId: number;
  readonly address: `0x${string}`;
  readonly tokenId: string;
  readonly standard: NftStandard;
  readonly name: string;
  readonly description: string;
  readonly imageUrl: string | null;
}

export interface WalletAccountMetadata {
  readonly version: 1;
  readonly accounts: readonly StoredWalletAccount[];
  readonly selectedPath: string;
}

export interface StorageService {
  saveVault(vault: EncryptedVault): Promise<void>;
  loadVault(): Promise<EncryptedVault | null>;
  clearVault(): Promise<void>;
  hasVault(): Promise<boolean>;
  saveAccountMetadata(metadata: WalletAccountMetadata): Promise<void>;
  loadAccountMetadata(): Promise<WalletAccountMetadata | null>;
  clearAccountMetadata(): Promise<void>;
}

export const storageService: StorageService = {
  async saveVault(vault) {
    const storage = getLocalStorage();
    const validatedVault = parseStoredVault(vault);
    storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(validatedVault));
  },

  async loadVault() {
    const storage = getLocalStorage();
    const serializedVault = storage.getItem(VAULT_STORAGE_KEY);
    if (serializedVault === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedVault);
    } catch {
      throw new Error("Stored vault is not valid JSON");
    }
    return parseStoredVault(parsed);
  },

  async clearVault() {
    const storage = getLocalStorage();
    storage.removeItem(VAULT_STORAGE_KEY);
    storage.removeItem(ACCOUNT_METADATA_STORAGE_KEY);
  },

  async hasVault() {
    return (await storageService.loadVault()) !== null;
  },

  async saveAccountMetadata(metadata) {
    const storage = getLocalStorage();
    const validatedMetadata = parseAccountMetadata(metadata);
    storage.setItem(
      ACCOUNT_METADATA_STORAGE_KEY,
      JSON.stringify(validatedMetadata),
    );
  },

  async loadAccountMetadata() {
    const storage = getLocalStorage();
    const serializedMetadata = storage.getItem(ACCOUNT_METADATA_STORAGE_KEY);
    if (serializedMetadata === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedMetadata);
    } catch {
      throw new Error("Stored account metadata is not valid JSON");
    }
    return parseAccountMetadata(parsed);
  },

  async clearAccountMetadata() {
    const storage = getLocalStorage();
    storage.removeItem(ACCOUNT_METADATA_STORAGE_KEY);
  },
};

function getLocalStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Wallet storage is only available in a browser");
  }
  return window.localStorage;
}

function parseStoredVault(value: unknown): EncryptedVault {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("salt" in value) ||
    !("iv" in value) ||
    !("ciphertext" in value)
  ) {
    throw new Error("Stored vault has an invalid structure");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.salt !== "string" ||
    typeof candidate.iv !== "string" ||
    typeof candidate.ciphertext !== "string"
  ) {
    throw new Error("Stored vault has an unsupported or invalid structure");
  }

  return {
    version: 1,
    salt: candidate.salt,
    iv: candidate.iv,
    ciphertext: candidate.ciphertext,
  };
}

function parseAccountMetadata(value: unknown): WalletAccountMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("accounts" in value) ||
    !("selectedPath" in value)
  ) {
    throw new Error("Stored account metadata has an invalid structure");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.accounts) ||
    typeof candidate.selectedPath !== "string"
  ) {
    throw new Error("Stored account metadata has an unsupported structure");
  }

  const accounts = candidate.accounts.map(parseStoredAccount);
  const paths = new Set(accounts.map((account) => account.path));
  if (
    accounts.length === 0 ||
    !paths.has(accountDerivationPath(0)) ||
    paths.size !== accounts.length ||
    accounts.every((account) => account.hidden)
  ) {
    throw new Error("Stored account metadata has invalid or duplicate accounts");
  }
  return {
    version: 1,
    accounts,
    selectedPath: candidate.selectedPath,
  };
}

function parseStoredAccount(value: unknown): StoredWalletAccount {
  if (
    typeof value !== "object" ||
    value === null ||
    !("path" in value) ||
    !("name" in value) ||
    !("hidden" in value)
  ) {
    throw new Error("Stored account metadata contains an invalid account");
  }

  const candidate = value as Record<string, unknown>;
  const index =
    typeof candidate.path === "string" ? accountIndex(candidate.path) : null;
  if (
    index === null ||
    typeof candidate.name !== "string" ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > 32 ||
    typeof candidate.hidden !== "boolean"
  ) {
    throw new Error("Stored account metadata contains an invalid account");
  }

  return {
    path: accountDerivationPath(index),
    name: candidate.name.trim(),
    hidden: candidate.hidden,
    tokens:
      candidate.tokens === undefined
        ? []
        : parseStoredTokens(candidate.tokens),
    nfts:
      candidate.nfts === undefined ? [] : parseStoredNfts(candidate.nfts),
  };
}

function parseStoredNfts(value: unknown): StoredWalletNft[] {
  if (!Array.isArray(value)) {
    throw new Error("Stored account metadata contains an invalid NFT list");
  }

  const nfts = value.map((nft): StoredWalletNft => {
    if (
      typeof nft !== "object" ||
      nft === null ||
      !("address" in nft) ||
      !("tokenId" in nft) ||
      !("standard" in nft) ||
      !("name" in nft) ||
      !("description" in nft) ||
      !("imageUrl" in nft)
    ) {
      throw new Error("Stored account metadata contains an invalid NFT");
    }
    const candidate = nft as Record<string, unknown>;
    let address: `0x${string}` | null = null;
    if (
      typeof candidate.address === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(candidate.address)
    ) {
      address = getAddress(candidate.address.toLowerCase());
    }
    let tokenId: bigint | null = null;
    if (
      typeof candidate.tokenId === "string" &&
      candidate.tokenId.length <= 78 &&
      /^(0|[1-9]\d*)$/.test(candidate.tokenId)
    ) {
      try {
        tokenId = BigInt(candidate.tokenId);
      } catch {
        tokenId = null;
      }
    }
    if (
      address === null ||
      tokenId === null ||
      tokenId > (BigInt("1") << BigInt("256")) - BigInt("1") ||
      typeof candidate.standard !== "string" ||
      (candidate.standard !== "ERC-721" &&
        candidate.standard !== "ERC-1155") ||
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0 ||
      candidate.name.length > 128 ||
      typeof candidate.description !== "string" ||
      candidate.description.length > 4000 ||
      (candidate.imageUrl !== null &&
        (typeof candidate.imageUrl !== "string" ||
          candidate.imageUrl.length > MAX_IMAGE_URL_LENGTH ||
          !isSafeImageUri(candidate.imageUrl)))
    ) {
      throw new Error("Stored account metadata contains an invalid NFT");
    }
    return {
      chainId: resolveStoredChainId(candidate.chainId),
      address,
      tokenId: tokenId.toString(),
      standard: candidate.standard,
      name: candidate.name.trim(),
      description: candidate.description,
      imageUrl:
        typeof candidate.imageUrl === "string" ? candidate.imageUrl : null,
    };
  });
  const keys = new Set(
    nfts.map(
      (nft) =>
        `${nft.chainId}:${nft.address.toLowerCase()}:${nft.tokenId}:${nft.standard}`,
    ),
  );
  if (keys.size !== nfts.length) {
    throw new Error("Stored account metadata contains duplicate NFTs");
  }
  return nfts;
}

function parseStoredTokens(value: unknown): StoredWalletToken[] {
  if (!Array.isArray(value)) {
    throw new Error("Stored account metadata contains an invalid token list");
  }

  const tokens = value.map((token): StoredWalletToken => {
    if (
      typeof token !== "object" ||
      token === null ||
      !("address" in token) ||
      !("name" in token) ||
      !("symbol" in token) ||
      !("decimals" in token) ||
      !("hidden" in token)
    ) {
      throw new Error("Stored account metadata contains an invalid token");
    }
    const candidate = token as Record<string, unknown>;
    let address: `0x${string}` | null = null;
    if (
      typeof candidate.address === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(candidate.address)
    ) {
      address = getAddress(candidate.address.toLowerCase());
    }
    if (
      address === null ||
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0 ||
      candidate.name.length > 128 ||
      typeof candidate.symbol !== "string" ||
      candidate.symbol.trim().length === 0 ||
      candidate.symbol.length > 32 ||
      typeof candidate.decimals !== "number" ||
      !Number.isInteger(candidate.decimals) ||
      candidate.decimals < 0 ||
      candidate.decimals > 255 ||
      typeof candidate.hidden !== "boolean"
    ) {
      throw new Error("Stored account metadata contains an invalid token");
    }
    return {
      chainId: resolveStoredChainId(candidate.chainId),
      address,
      name: candidate.name.trim(),
      symbol: candidate.symbol.trim(),
      decimals: candidate.decimals,
      hidden: candidate.hidden,
    };
  });

  const addresses = new Set(
    tokens.map((token) => `${token.chainId}:${token.address}`),
  );
  if (addresses.size !== tokens.length) {
    throw new Error("Stored account metadata contains duplicate tokens");
  }
  return tokens;
}

/**
 * Resolves a stored `chainId`. Legacy entries saved before multi-chain support
 * have no chain and default to Sepolia; unknown chains are rejected so a
 * tampered vault cannot point an asset at an unsupported network.
 */
function resolveStoredChainId(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_CHAIN_ID;
  if (!isSupportedChainId(value)) {
    throw new Error("Stored account metadata references an unsupported chain");
  }
  return value;
}

function accountIndex(path: string): number | null {
  const match = /^m\/44'\/60'\/0'\/0\/(0|[1-9]\d*)$/.exec(path);
  if (!match) return null;

  const index = Number(match[1]);
  try {
    return accountDerivationPath(index) === path ? index : null;
  } catch {
    return null;
  }
}
