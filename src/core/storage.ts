import type { EncryptedVault } from "./crypto";
import {
  validateBiometricVault,
  type BiometricVault,
} from "./biometric-vault";
import { accountDerivationPath } from "./hd-wallet";
import { isSafeImageUri, MAX_IMAGE_URL_LENGTH } from "./url-safety";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "./chain";
import { getAddress } from "viem";

/**
 * Legacy single-wallet key names. They are read once by the migration that
 * adopts an existing install into the multi-wallet registry (see
 * `loadRegistry`), and are never written again.
 */
export const VAULT_STORAGE_KEY = "wallet_vault_v1";
export const ACCOUNT_METADATA_STORAGE_KEY = "wallet_accounts_v1";
export const BIOMETRIC_VAULT_STORAGE_KEY = "wallet_biometric_v1";

/** Registry of the wallets stored on this device. */
export const WALLET_REGISTRY_STORAGE_KEY = "wallet_registry_v1";

/**
 * Wallet ids become part of a storage key, so they must be safe, non-empty
 * tokens. Generated ids are UUIDs, which satisfy this.
 */
const WALLET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Per-wallet storage key: the legacy name namespaced by the wallet id. */
export function walletVaultKey(walletId: string): string {
  return `${VAULT_STORAGE_KEY}:${walletId}`;
}
export function walletAccountMetadataKey(walletId: string): string {
  return `${ACCOUNT_METADATA_STORAGE_KEY}:${walletId}`;
}
export function walletBiometricVaultKey(walletId: string): string {
  return `${BIOMETRIC_VAULT_STORAGE_KEY}:${walletId}`;
}

/** Generates a fresh, storage-safe wallet id. */
export function createWalletId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The pseudo derivation path stored for an account that came from an imported
 * private key. Such a wallet has no BIP-32 lineage, so it holds exactly one
 * account and is addressed by this sentinel instead of `m/44'/60'/...`.
 */
export const IMPORTED_ACCOUNT_PATH = "imported";

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

/** A wallet entry in the registry. No key material lives here. */
export interface StoredWalletSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  /**
   * How the wallet was set up. Absent on entries written before private-key
   * import existed, which are always recovery-phrase wallets.
   */
  readonly kind?: "mnemonic" | "privateKey";
  /**
   * SHA-256 of the wallet's primary address (see `fingerprintAddress`). Used to
   * refuse importing a key whose address is already on the device without
   * storing the address itself.
   */
  readonly addressFingerprint?: string;
}

export interface WalletRegistry {
  readonly version: 1;
  readonly wallets: readonly StoredWalletSummary[];
  readonly selectedId: string | null;
}

export interface StorageService {
  saveRegistry(registry: WalletRegistry): Promise<void>;
  loadRegistry(): Promise<WalletRegistry | null>;
  clearRegistry(): Promise<void>;
  saveVault(walletId: string, vault: EncryptedVault): Promise<void>;
  loadVault(walletId: string): Promise<EncryptedVault | null>;
  clearVault(walletId: string): Promise<void>;
  hasVault(walletId: string): Promise<boolean>;
  saveBiometricVault(walletId: string, vault: BiometricVault): Promise<void>;
  loadBiometricVault(walletId: string): Promise<BiometricVault | null>;
  clearBiometricVault(walletId: string): Promise<void>;
  saveAccountMetadata(
    walletId: string,
    metadata: WalletAccountMetadata,
  ): Promise<void>;
  loadAccountMetadata(walletId: string): Promise<WalletAccountMetadata | null>;
  clearAccountMetadata(walletId: string): Promise<void>;
}

export const storageService: StorageService = {
  async saveRegistry(registry) {
    const storage = getLocalStorage();
    const validated = parseRegistry(registry);
    storage.setItem(WALLET_REGISTRY_STORAGE_KEY, JSON.stringify(validated));
  },

  async loadRegistry() {
    const storage = getLocalStorage();
    const serialized = storage.getItem(WALLET_REGISTRY_STORAGE_KEY);
    if (serialized === null) {
      // No registry yet: adopt a pre-multi-wallet install, if one exists.
      return adoptLegacyWallet(storage);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("Stored wallet registry is not valid JSON");
    }
    return parseRegistry(parsed);
  },

  async clearRegistry() {
    const storage = getLocalStorage();
    storage.removeItem(WALLET_REGISTRY_STORAGE_KEY);
  },

  async saveVault(walletId, vault) {
    const storage = getLocalStorage();
    const validatedVault = parseStoredVault(vault);
    storage.setItem(
      walletVaultKey(assertWalletId(walletId)),
      JSON.stringify(validatedVault),
    );
  },

  async loadVault(walletId) {
    const storage = getLocalStorage();
    const serializedVault = storage.getItem(
      walletVaultKey(assertWalletId(walletId)),
    );
    if (serializedVault === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedVault);
    } catch {
      throw new Error("Stored vault is not valid JSON");
    }
    return parseStoredVault(parsed);
  },

  async clearVault(walletId) {
    const storage = getLocalStorage();
    const id = assertWalletId(walletId);
    storage.removeItem(walletVaultKey(id));
    storage.removeItem(walletAccountMetadataKey(id));
    storage.removeItem(walletBiometricVaultKey(id));
  },

  async hasVault(walletId) {
    return (await storageService.loadVault(walletId)) !== null;
  },

  async saveBiometricVault(walletId, vault) {
    const storage = getLocalStorage();
    const validatedVault = validateBiometricVault(vault);
    storage.setItem(
      walletBiometricVaultKey(assertWalletId(walletId)),
      JSON.stringify(validatedVault),
    );
  },

  async loadBiometricVault(walletId) {
    const storage = getLocalStorage();
    const serializedVault = storage.getItem(
      walletBiometricVaultKey(assertWalletId(walletId)),
    );
    if (serializedVault === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedVault);
    } catch {
      throw new Error("Stored biometric vault is not valid JSON");
    }
    return validateBiometricVault(parsed);
  },

  async clearBiometricVault(walletId) {
    const storage = getLocalStorage();
    storage.removeItem(walletBiometricVaultKey(assertWalletId(walletId)));
  },

  async saveAccountMetadata(walletId, metadata) {
    const storage = getLocalStorage();
    const validatedMetadata = parseAccountMetadata(metadata);
    storage.setItem(
      walletAccountMetadataKey(assertWalletId(walletId)),
      JSON.stringify(validatedMetadata),
    );
  },

  async loadAccountMetadata(walletId) {
    const storage = getLocalStorage();
    const serializedMetadata = storage.getItem(
      walletAccountMetadataKey(assertWalletId(walletId)),
    );
    if (serializedMetadata === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedMetadata);
    } catch {
      throw new Error("Stored account metadata is not valid JSON");
    }
    return parseAccountMetadata(parsed);
  },

  async clearAccountMetadata(walletId) {
    const storage = getLocalStorage();
    storage.removeItem(walletAccountMetadataKey(assertWalletId(walletId)));
  },
};

function getLocalStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Wallet storage is only available in a browser");
  }
  return window.localStorage;
}

function assertWalletId(walletId: string): string {
  if (!WALLET_ID_PATTERN.test(walletId)) {
    throw new Error("Wallet id is not a valid storage token");
  }
  return walletId;
}

/**
 * Adopts a wallet saved before multi-wallet support as the first registry
 * entry. Returns `null` when no legacy wallet exists, so a fresh install simply
 * starts with an empty registry.
 */
function adoptLegacyWallet(storage: Storage): WalletRegistry | null {
  const legacyVault = storage.getItem(VAULT_STORAGE_KEY);
  if (legacyVault === null) return null;

  const walletId = createWalletId();
  // Re-key the vault first: without it the wallet is unusable, so it must be
  // safely in place before the legacy key is dropped.
  storage.setItem(walletVaultKey(walletId), legacyVault);
  const legacyAccounts = storage.getItem(ACCOUNT_METADATA_STORAGE_KEY);
  if (legacyAccounts !== null) {
    storage.setItem(walletAccountMetadataKey(walletId), legacyAccounts);
  }
  const legacyBiometric = storage.getItem(BIOMETRIC_VAULT_STORAGE_KEY);
  if (legacyBiometric !== null) {
    storage.setItem(walletBiometricVaultKey(walletId), legacyBiometric);
  }
  storage.removeItem(VAULT_STORAGE_KEY);
  storage.removeItem(ACCOUNT_METADATA_STORAGE_KEY);
  storage.removeItem(BIOMETRIC_VAULT_STORAGE_KEY);

  const registry: WalletRegistry = {
    version: 1,
    wallets: [
      { id: walletId, name: "Wallet 1", createdAt: Date.now(), kind: "mnemonic" },
    ],
    selectedId: walletId,
  };
  storage.setItem(WALLET_REGISTRY_STORAGE_KEY, JSON.stringify(registry));
  return registry;
}

function parseRegistry(value: unknown): WalletRegistry {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("wallets" in value) ||
    !("selectedId" in value)
  ) {
    throw new Error("Stored wallet registry has an invalid structure");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.wallets) ||
    (candidate.selectedId !== null && typeof candidate.selectedId !== "string")
  ) {
    throw new Error("Stored wallet registry has an unsupported structure");
  }

  const wallets = candidate.wallets.map(parseStoredWallet);
  const ids = new Set(wallets.map((wallet) => wallet.id));
  if (ids.size !== wallets.length) {
    throw new Error("Stored wallet registry contains duplicate wallets");
  }
  // A selection that points at a missing wallet is dropped rather than fatal,
  // so a half-written registry can never lock the user out of the list.
  const selectedId =
    typeof candidate.selectedId === "string" &&
    ids.has(candidate.selectedId)
      ? candidate.selectedId
      : null;
  return { version: 1, wallets, selectedId };
}

function parseStoredWallet(value: unknown): StoredWalletSummary {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("name" in value) ||
    !("createdAt" in value)
  ) {
    throw new Error("Stored wallet registry contains an invalid wallet");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !WALLET_ID_PATTERN.test(candidate.id) ||
    typeof candidate.name !== "string" ||
    candidate.name.trim().length === 0 ||
    candidate.name.trim().length > 32 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt) ||
    (candidate.kind !== undefined &&
      candidate.kind !== "mnemonic" &&
      candidate.kind !== "privateKey") ||
    (candidate.addressFingerprint !== undefined &&
      (typeof candidate.addressFingerprint !== "string" ||
        !/^[0-9a-f]{64}$/.test(candidate.addressFingerprint)))
  ) {
    throw new Error("Stored wallet registry contains an invalid wallet");
  }

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    createdAt: candidate.createdAt,
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
    ...(candidate.addressFingerprint === undefined
      ? {}
      : { addressFingerprint: candidate.addressFingerprint }),
  };
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
  const hasImportedAccount = paths.has(IMPORTED_ACCOUNT_PATH);
  // A wallet is either an HD wallet (and must contain the default account) or a
  // single imported-key account. The two shapes never mix.
  const isImportedWallet = accounts.length === 1 && hasImportedAccount;
  const isHdWallet = !hasImportedAccount && paths.has(accountDerivationPath(0));
  if (
    accounts.length === 0 ||
    paths.size !== accounts.length ||
    accounts.every((account) => account.hidden) ||
    !(isImportedWallet || isHdWallet)
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
  const isImported = candidate.path === IMPORTED_ACCOUNT_PATH;
  const index =
    typeof candidate.path === "string" && !isImported
      ? accountIndex(candidate.path)
      : isImported
        ? 0
        : null;
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
    path: isImported ? IMPORTED_ACCOUNT_PATH : accountDerivationPath(index),
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
