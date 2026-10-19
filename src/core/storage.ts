import type { EncryptedVault } from "./crypto";
import {
  validateBiometricVault,
  type BiometricVault,
} from "./biometric-vault";
import { accountDerivationPath } from "./hd-wallet";
import { isSafeImageUri, MAX_IMAGE_URL_LENGTH } from "./url-safety";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "./chain";
import { createIndexedDbBackend, type StorageBackend } from "./storage-backend";
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

export interface LegacyLocalStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface StorageServiceOptions {
  /**
   * Synchronous storage imported once and then cleared. Defaults to
   * `window.localStorage`. `null` disables the import (server render, tests).
   */
  readonly legacyStorage?: LegacyLocalStorage | null;
}

/**
 * Marker recording that the `localStorage` → IndexedDB move already ran. It
 * lives in IndexedDB, so a half-finished migration retries on the next load.
 */
const STORAGE_MIGRATION_MARKER_KEY = "wallet_storage_migrated_v1";

const LEGACY_WALLET_KEY_PREFIXES = [
  VAULT_STORAGE_KEY,
  ACCOUNT_METADATA_STORAGE_KEY,
  BIOMETRIC_VAULT_STORAGE_KEY,
] as const;

export function createStorageService(
  backend: StorageBackend,
  options: StorageServiceOptions = {},
): StorageService {
  let migration: Promise<void> | null = null;
  let persistenceRequested = false;

  /**
   * Asks the browser not to evict the database under storage pressure. Best
   * effort: unsupported browsers (and denied requests) simply ignore it. Runs
   * once, after the first successful write.
   */
  function requestPersistentStorage(): void {
    if (persistenceRequested || typeof navigator === "undefined") return;
    persistenceRequested = true;
    try {
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch {
      // Blocked or unsupported: not fatal.
    }
  }

  function ensureMigrated(): Promise<void> {
    if (migration !== null) return migration;

    const legacy = resolveLegacyStorage(options);
    // Nothing to import: do not cache, so a browser that briefly hides
    // `localStorage` can still migrate on a later call.
    if (legacy === null) return Promise.resolve();

    const pending = migrateLegacyLocalStorage(backend, legacy);
    migration = pending;
    // A failed import must not poison the service: the next call retries.
    pending.catch(() => {
      if (migration === pending) migration = null;
    });
    return pending;
  }

  const service: StorageService = {
    async saveRegistry(registry) {
      await ensureMigrated();
      const validated = parseRegistry(registry);
      await backend.set(
        WALLET_REGISTRY_STORAGE_KEY,
        JSON.stringify(validated),
      );
      requestPersistentStorage();
    },

    async loadRegistry() {
      await ensureMigrated();
      const serialized = await backend.get(WALLET_REGISTRY_STORAGE_KEY);
      if (serialized === null) {
        // No registry yet: adopt a pre-multi-wallet install, if one exists.
        return adoptLegacyWallet(backend);
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
      await ensureMigrated();
      await backend.delete(WALLET_REGISTRY_STORAGE_KEY);
    },

    async saveVault(walletId, vault) {
      await ensureMigrated();
      const validatedVault = parseStoredVault(vault);
      await backend.set(
        walletVaultKey(assertWalletId(walletId)),
        JSON.stringify(validatedVault),
      );
      requestPersistentStorage();
    },

    async loadVault(walletId) {
      await ensureMigrated();
      const serializedVault = await backend.get(
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
      await ensureMigrated();
      const id = assertWalletId(walletId);
      await backend.deleteMany([
        walletVaultKey(id),
        walletAccountMetadataKey(id),
        walletBiometricVaultKey(id),
      ]);
    },

    async hasVault(walletId) {
      return (await service.loadVault(walletId)) !== null;
    },

    async saveBiometricVault(walletId, vault) {
      await ensureMigrated();
      const validatedVault = validateBiometricVault(vault);
      await backend.set(
        walletBiometricVaultKey(assertWalletId(walletId)),
        JSON.stringify(validatedVault),
      );
    },

    async loadBiometricVault(walletId) {
      await ensureMigrated();
      const serializedVault = await backend.get(
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
      await ensureMigrated();
      await backend.delete(walletBiometricVaultKey(assertWalletId(walletId)));
    },

    async saveAccountMetadata(walletId, metadata) {
      await ensureMigrated();
      const validatedMetadata = parseAccountMetadata(metadata);
      await backend.set(
        walletAccountMetadataKey(assertWalletId(walletId)),
        JSON.stringify(validatedMetadata),
      );
    },

    async loadAccountMetadata(walletId) {
      await ensureMigrated();
      const serializedMetadata = await backend.get(
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
      await ensureMigrated();
      await backend.delete(
        walletAccountMetadataKey(assertWalletId(walletId)),
      );
    },
  };

  return service;
}

export const storageService: StorageService = createStorageService(
  createIndexedDbBackend(),
);

function resolveLegacyStorage(
  options: StorageServiceOptions,
): LegacyLocalStorage | null {
  if (options.legacyStorage !== undefined) return options.legacyStorage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Blocked storage (private mode, policy) is not an error: there is simply
    // nothing to import.
    return null;
  }
}

/**
 * Copies every wallet record out of `localStorage` and into the backend.
 *
 * Ordering matters: the IndexedDB transaction commits before any legacy key is
 * removed, so a crash can leave duplicates but never a lost wallet. The marker
 * is written before the cleanup, so a later run can never copy stale values
 * over newer IndexedDB data.
 */
async function migrateLegacyLocalStorage(
  backend: StorageBackend,
  legacy: LegacyLocalStorage,
): Promise<void> {
  if ((await backend.get(STORAGE_MIGRATION_MARKER_KEY)) !== null) return;

  const records = collectLegacyRecords(legacy);
  // Nothing to import: leave the marker unwritten so a profile restored or
  // synced later can still be migrated on a future load. (Writing the marker
  // here would permanently disable the import for an install that happened to
  // start with an empty localStorage.)
  if (records.length === 0) return;

  await backend.setMany(records);
  await backend.set(STORAGE_MIGRATION_MARKER_KEY, "1");

  for (const [key] of records) {
    try {
      legacy.removeItem(key);
    } catch {
      // The marker guarantees these keys are never imported again.
    }
  }
}

function collectLegacyRecords(
  legacy: LegacyLocalStorage,
): Array<readonly [string, string]> {
  const keys = new Set<string>([WALLET_REGISTRY_STORAGE_KEY]);
  for (let index = 0; index < legacy.length; index += 1) {
    const key = legacy.key(index);
    if (key === null) continue;
    if (isWalletStorageKey(key)) keys.add(key);
  }

  const records: Array<readonly [string, string]> = [];
  for (const key of keys) {
    const value = legacy.getItem(key);
    if (value !== null) records.push([key, value]);
  }
  return records;
}

function isWalletStorageKey(key: string): boolean {
  return LEGACY_WALLET_KEY_PREFIXES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}:`),
  );
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
async function adoptLegacyWallet(
  backend: StorageBackend,
): Promise<WalletRegistry | null> {
  const legacyVault = await backend.get(VAULT_STORAGE_KEY);
  if (legacyVault === null) return null;

  const walletId = createWalletId();
  // Re-key the records first: without the vault the wallet is unusable, so it
  // must be safely in place before the legacy keys are dropped.
  const rekeyed: Array<readonly [string, string]> = [
    [walletVaultKey(walletId), legacyVault],
  ];
  const legacyAccounts = await backend.get(ACCOUNT_METADATA_STORAGE_KEY);
  if (legacyAccounts !== null) {
    rekeyed.push([walletAccountMetadataKey(walletId), legacyAccounts]);
  }
  const legacyBiometric = await backend.get(BIOMETRIC_VAULT_STORAGE_KEY);
  if (legacyBiometric !== null) {
    rekeyed.push([walletBiometricVaultKey(walletId), legacyBiometric]);
  }
  await backend.setMany(rekeyed);

  const registry: WalletRegistry = {
    version: 1,
    wallets: [
      {
        id: walletId,
        name: "Wallet 1",
        createdAt: Date.now(),
        kind: "mnemonic",
      },
    ],
    selectedId: walletId,
  };
  // Persist the registry before deleting the bare keys: a crash in between
  // leaves an unreferenced copy, never an unreachable wallet.
  await backend.set(WALLET_REGISTRY_STORAGE_KEY, JSON.stringify(registry));
  await backend.deleteMany([
    VAULT_STORAGE_KEY,
    ACCOUNT_METADATA_STORAGE_KEY,
    BIOMETRIC_VAULT_STORAGE_KEY,
  ]);
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
      candidate.kind !== "privateKey")
  ) {
    throw new Error("Stored wallet registry contains an invalid wallet");
  }

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    createdAt: candidate.createdAt,
    ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
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
