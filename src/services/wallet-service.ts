import type { Address, Hash, Hex } from "viem";
import type {
  Erc20TransferEstimate,
  NativeTransferEstimate,
} from "./transaction-service";
import {
  decryptVault,
  encryptVault,
  VaultDecryptionError,
} from "@/core/crypto";
import {
  deriveAccountAtIndex,
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
  accountDerivationPath,
  MAX_ADDRESS_INDEX,
} from "@/core/hd-wallet";
import { addressFromPrivateKey, normalizePrivateKey } from "@/core/private-key";
import { encodeVaultSecret, parseVaultSecret } from "@/core/vault-secret";
import {
  createWalletId,
  IMPORTED_ACCOUNT_PATH,
  storageService,
  type NftStandard,
  type StoredWalletNft,
  type StoredWalletSummary,
  type StoredWalletToken,
  type StorageService,
  type WalletAccountMetadata,
  type WalletRegistry,
} from "@/core/storage";
import {
  createPrfSalt,
  unwrapMnemonic,
  wrapMnemonic,
  type BiometricVault,
} from "@/core/biometric-vault";
import {
  evaluatePrf,
  isBiometricUnlockSupported,
  registerBiometricCredential,
} from "@/core/webauthn";
import { decodeBase64 } from "@/lib/base64";
import {
  createUnlockThrottle,
  UnlockThrottledError,
  type UnlockThrottle,
} from "@/lib/unlock-throttle";
import { sendErc20Transfer, sendNativeTransfer } from "./transaction-service";
import {
  readDelegatedAddress as defaultReadDelegatedAddress,
  revokeDelegation as defaultRevokeDelegation,
} from "./account-abstraction-service";
import { chainService } from "./chain-service";
import {
  normalizeNftAddress,
  parseNftTokenId,
  readNftMetadata,
  readNftOwnership,
} from "./nft-service";
import {
  normalizeTokenAddress,
  readTokenMetadata,
} from "./token-service";

export interface WalletState {
  readonly isUnlocked: boolean;
  readonly address: Address | null;
  readonly accounts: readonly WalletAccount[];
  readonly selectedAccountIndex: number | null;
  readonly wallets: readonly StoredWalletSummary[];
  readonly selectedWalletId: string | null;
}

export interface WalletAccount {
  readonly index: number;
  readonly path: string;
  readonly name: string;
  readonly address: Address;
  readonly hidden: boolean;
  readonly tokens: readonly StoredWalletToken[];
  readonly nfts: readonly StoredWalletNft[];
}

export interface PreparedWallet {
  mnemonic: string;
  address: Address;
}

/**
 * Wraps the passkey ceremony so the service stays testable and the browser
 * APIs are only touched in one place (`core/webauthn.ts`).
 */
export interface BiometricUnlockProvider {
  isSupported(): Promise<boolean>;
  register(options: {
    rpId: string;
    userName: string;
    prfSalt: Uint8Array;
  }): Promise<{ credentialId: string; prfOutput: Uint8Array }>;
  evaluate(options: {
    credentialId: string;
    prfSalt: Uint8Array;
    rpId: string;
  }): Promise<Uint8Array>;
  getRpId(): string | null;
}

const defaultBiometricProvider: BiometricUnlockProvider = {
  isSupported: isBiometricUnlockSupported,
  register: registerBiometricCredential,
  evaluate: evaluatePrf,
  getRpId: () =>
    typeof window === "undefined" ? null : window.location.hostname,
};

/** Why the session ended; drives the unlock-screen notice. */
export type LockReason = "manual" | "inactivity";

export interface WalletServiceDependencies {
  storage?: StorageService;
  biometric?: BiometricUnlockProvider;
  /** Failed-unlock throttle; injectable so tests can control the cooldown. */
  unlockThrottle?: UnlockThrottle;
  readTokenMetadata?: (
    address: Address,
    chainId: number,
  ) => Promise<Omit<StoredWalletToken, "hidden">>;
  readNftMetadata?: (
    address: Address,
    tokenId: bigint,
    standard: NftStandard,
    chainId: number,
  ) => Promise<StoredWalletNft>;
  readNftOwnership?: (
    address: Address,
    tokenId: bigint,
    standard: NftStandard,
    owner: Address,
    chainId: number,
  ) => Promise<boolean>;
  sendTransfer?: (params: {
    to: Address;
    value: bigint;
    chainId: number;
    privateKey: Hex;
    gas?: bigint;
    gasPrice?: bigint;
  }) => Promise<Hash>;
  sendTokenTransfer?: (params: {
    token: Address;
    to: Address;
    amount: bigint;
    chainId: number;
    privateKey: Hex;
    gas?: bigint;
    gasPrice?: bigint;
  }) => Promise<Hash>;
  /** Reads the EIP-7702 delegate address for an account, if any. */
  readDelegatedAddress?: (
    address: Address,
    chainId: number,
  ) => Promise<Address | null>;
  /** Signs and broadcasts an EIP-7702 authorization that clears a delegation. */
  revokeDelegation?: (params: {
    address: Address;
    chainId: number;
    privateKey: Hex;
  }) => Promise<Hash>;
  /** Supplies the chain used by background work (NFT ownership sync). */
  getActiveChainId?: () => number;
}

interface PendingWallet extends PreparedWallet {
  id: string;
  name: string;
  account: WalletAccount;
  privateKey: Hex;
  seed: Uint8Array;
}

export class WalletService {
  private seed: Uint8Array | null = null;
  private readonly privateKeys = new Map<number, Hex>();
  private state: WalletState = Object.freeze({
    isUnlocked: false,
    address: null,
    accounts: Object.freeze([]),
    selectedAccountIndex: null,
    wallets: Object.freeze([]),
    selectedWalletId: null,
  });
  private registry: WalletRegistry = Object.freeze({
    version: 1,
    wallets: Object.freeze([]),
    selectedId: null,
  });
  private registryLoaded = false;
  private pendingWallet: PendingWallet | null = null;
  private operationVersion = 0;
  private accountMutationVersion = 0;
  private accountMutationInProgress = false;
  private nftOwnershipSyncInProgress = false;
  private walletCreationInProgress = false;
  private readonly listeners = new Set<() => void>();
  private readonly storage: StorageService;
  private readonly sendTransfer: NonNullable<
    WalletServiceDependencies["sendTransfer"]
  >;
  private readonly sendTokenTransfer: NonNullable<
    WalletServiceDependencies["sendTokenTransfer"]
  >;
  private readonly readTokenMetadata: NonNullable<
    WalletServiceDependencies["readTokenMetadata"]
  >;
  private readonly readNftMetadata: NonNullable<
    WalletServiceDependencies["readNftMetadata"]
  >;
  private readonly readNftOwnership: NonNullable<
    WalletServiceDependencies["readNftOwnership"]
  >;
  private readonly getActiveChainId: NonNullable<
    WalletServiceDependencies["getActiveChainId"]
  >;
  private readonly readDelegatedAddress: NonNullable<
    WalletServiceDependencies["readDelegatedAddress"]
  >;
  private readonly revokeDelegation: NonNullable<
    WalletServiceDependencies["revokeDelegation"]
  >;
  private readonly biometric: BiometricUnlockProvider;
  private readonly unlockThrottle: UnlockThrottle;
  private lastLockReason: LockReason | null = null;

  constructor(dependencies: WalletServiceDependencies = {}) {
    this.storage = dependencies.storage ?? storageService;
    this.unlockThrottle =
      dependencies.unlockThrottle ?? createUnlockThrottle();
    this.sendTransfer = dependencies.sendTransfer ?? sendNativeTransfer;
    this.sendTokenTransfer =
      dependencies.sendTokenTransfer ?? sendErc20Transfer;
    this.readTokenMetadata = dependencies.readTokenMetadata ?? readTokenMetadata;
    this.readNftMetadata = dependencies.readNftMetadata ?? readNftMetadata;
    this.readNftOwnership = dependencies.readNftOwnership ?? readNftOwnership;
    this.getActiveChainId =
      dependencies.getActiveChainId ?? (() => chainService.activeChainId);
    this.readDelegatedAddress =
      dependencies.readDelegatedAddress ?? defaultReadDelegatedAddress;
    this.revokeDelegation =
      dependencies.revokeDelegation ?? defaultRevokeDelegation;
    this.biometric = dependencies.biometric ?? defaultBiometricProvider;
  }

  get isUnlocked(): boolean {
    return this.state.isUnlocked;
  }

  getState(): WalletState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async prepareWallet(): Promise<PreparedWallet> {
    this.assertNoWalletCreationInProgress();
    const registryVersion = this.operationVersion;
    await this.ensureRegistry();
    this.assertOperationCurrent(registryVersion);
    this.lock();
    const operationVersion = this.operationVersion;

    const mnemonic = generateMnemonic();
    const { account, seed } = await deriveAccountFromMnemonic(mnemonic, 0);
    try {
      this.assertOperationCurrent(operationVersion);
      this.pendingWallet = {
        id: createWalletId(),
        name: this.nextWalletName(),
        mnemonic,
        address: account.address,
        account: createWalletAccount(0, account.address),
        privateKey: account.privateKey,
        seed,
      };
      return { mnemonic, address: account.address };
    } catch (error) {
      seed.fill(0);
      throw error;
    }
  }

  async createWallet(
    password: string,
    backupConfirmed: boolean,
  ): Promise<PreparedWallet> {
    if (backupConfirmed !== true) {
      throw new Error("Confirm that you have backed up the recovery phrase");
    }
    const pendingWallet = this.pendingWallet;
    if (!pendingWallet) {
      throw new Error("Prepare a wallet before confirming its backup");
    }
    if (this.walletCreationInProgress) {
      throw new Error("Wallet creation is already in progress");
    }
    this.walletCreationInProgress = true;
    const operationVersion = this.operationVersion;

    try {
      const vault = await encryptVault(
        encodeVaultSecret({ kind: "mnemonic", secret: pendingWallet.mnemonic }),
        password,
      );
      this.assertOperationCurrent(operationVersion);
      await this.storage.saveVault(pendingWallet.id, vault);
      try {
        this.assertOperationCurrent(operationVersion);
        const account = pendingWallet.account;
        await this.storage.saveAccountMetadata(pendingWallet.id, {
          version: 1,
          accounts: [
            {
              path: account.path,
              name: account.name,
              hidden: false,
            },
          ],
          selectedPath: account.path,
        });
        this.assertOperationCurrent(operationVersion);
      } catch (error) {
        await this.storage.clearVault(pendingWallet.id);
        throw error;
      }

      const registry = addWalletToRegistry(this.registry, {
        id: pendingWallet.id,
        name: pendingWallet.name,
        createdAt: Date.now(),
        kind: "mnemonic",
      });
      await this.storage.saveRegistry(registry);
      this.assertOperationCurrent(operationVersion);
      this.registry = registry;

      this.activateWallet(pendingWallet.seed, [pendingWallet.account], 0, pendingWallet.privateKey);
      this.pendingWallet = null;
      return {
        mnemonic: pendingWallet.mnemonic,
        address: pendingWallet.address,
      };
    } finally {
      this.walletCreationInProgress = false;
    }
  }

  async importWallet(mnemonic: string, password: string): Promise<Address> {
    this.assertNoWalletCreationInProgress();
    if (!validateMnemonic(mnemonic)) {
      throw new Error("Invalid BIP-39 mnemonic");
    }
    const registryVersion = this.operationVersion;
    await this.ensureRegistry();
    this.assertOperationCurrent(registryVersion);
    this.lock();
    const operationVersion = this.operationVersion;

    const normalizedMnemonic = mnemonic.trim().split(/\s+/).join(" ");
    const { account, seed } = await deriveAccountFromMnemonic(normalizedMnemonic, 0);
    let seedTransferred = false;
    try {
      this.assertOperationCurrent(operationVersion);
      const vault = await encryptVault(
        encodeVaultSecret({ kind: "mnemonic", secret: normalizedMnemonic }),
        password,
      );
      this.assertOperationCurrent(operationVersion);
      const walletId = createWalletId();
      const walletName = this.nextWalletName();
      await this.storage.saveVault(walletId, vault);
      try {
        this.assertOperationCurrent(operationVersion);
        const walletAccount = createWalletAccount(0, account.address);
        await this.storage.saveAccountMetadata(walletId, {
          version: 1,
          accounts: [
            { path: walletAccount.path, name: walletAccount.name, hidden: false },
          ],
          selectedPath: walletAccount.path,
        });
        this.assertOperationCurrent(operationVersion);
      } catch (error) {
        await this.storage.clearVault(walletId);
        throw error;
      }
      const registry = addWalletToRegistry(this.registry, {
        id: walletId,
        name: walletName,
        createdAt: Date.now(),
        kind: "mnemonic",
      });
      await this.storage.saveRegistry(registry);
      this.assertOperationCurrent(operationVersion);
      this.registry = registry;
      const walletAccount = createWalletAccount(0, account.address);
      this.activateWallet(seed, [walletAccount], 0, account.privateKey);
      seedTransferred = true;
      return account.address;
    } finally {
      if (!seedTransferred) seed.fill(0);
    }
  }

  /**
   * Imports a single private key as its own wallet with one account.
   *
   * A raw key has no BIP-32 lineage, so the resulting wallet cannot derive
   * further accounts: `addAccount` refuses, and address recovery depends on the
   * key itself rather than on a recovery phrase. The key is validated and its
   * address derived before anything is persisted.
   */
  async importPrivateKey(privateKey: string, password: string): Promise<Address> {
    this.assertNoWalletCreationInProgress();
    const normalizedKey = normalizePrivateKey(privateKey);
    const address = addressFromPrivateKey(normalizedKey);
    const registryVersion = this.operationVersion;
    await this.ensureRegistry();
    this.assertOperationCurrent(registryVersion);
    this.lock();
    const operationVersion = this.operationVersion;

    this.assertOperationCurrent(operationVersion);
    const vault = await encryptVault(
      encodeVaultSecret({ kind: "privateKey", secret: normalizedKey }),
      password,
    );
    this.assertOperationCurrent(operationVersion);
    const walletId = createWalletId();
    const walletName = this.nextWalletName("Imported key");
    await this.storage.saveVault(walletId, vault);
    try {
      this.assertOperationCurrent(operationVersion);
      await this.storage.saveAccountMetadata(walletId, createImportedMetadata());
      this.assertOperationCurrent(operationVersion);
    } catch (error) {
      await this.storage.clearVault(walletId);
      throw error;
    }
    const registry = addWalletToRegistry(this.registry, {
      id: walletId,
      name: walletName,
      createdAt: Date.now(),
      kind: "privateKey",
    });
    await this.storage.saveRegistry(registry);
    this.assertOperationCurrent(operationVersion);
    this.registry = registry;
    this.activateImportedWallet(createImportedAccount(address), normalizedKey);
    return address;
  }

  async unlock(password: string): Promise<void> {
    this.assertNoWalletCreationInProgress();
    this.lock();
    const operationVersion = this.operationVersion;
    await this.ensureRegistry();
    this.assertOperationCurrent(operationVersion);
    const walletId = this.registry.selectedId;
    if (!walletId) {
      throw new Error("No wallet is stored on this device");
    }
    const vault = await this.storage.loadVault(walletId);
    this.assertOperationCurrent(operationVersion);
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }

    const retryAfterMs = this.unlockThrottle.retryAfterMs(walletId);
    if (retryAfterMs > 0) {
      throw new UnlockThrottledError(retryAfterMs);
    }

    let payload: string;
    try {
      payload = await decryptVault(vault, password);
    } catch (error) {
      if (error instanceof VaultDecryptionError) {
        this.unlockThrottle.recordFailure(walletId);
        // Surface the cooldown on the attempt that starts it, not one later.
        const remaining = this.unlockThrottle.retryAfterMs(walletId);
        if (remaining > 0) throw new UnlockThrottledError(remaining);
      }
      throw error;
    }
    this.unlockThrottle.recordSuccess(walletId);

    this.assertOperationCurrent(operationVersion);
    const secret = parseVaultSecret(payload);
    if (secret.kind === "privateKey") {
      await this.activateFromPrivateKey(secret.secret, operationVersion, walletId);
    } else {
      await this.activateFromMnemonic(secret.secret, operationVersion, walletId);
    }
  }

  /**
   * Starts a session from a decrypted private key. Mirrors
   * `activateFromMnemonic` for the single-account, non-HD wallet shape.
   */
  private async activateFromPrivateKey(
    privateKey: string,
    operationVersion: number,
    walletId: string,
  ): Promise<void> {
    const normalizedKey = normalizePrivateKey(privateKey);
    const address = addressFromPrivateKey(normalizedKey);
    this.assertOperationCurrent(operationVersion);

    const storedMetadata = await this.storage.loadAccountMetadata(walletId);
    this.assertOperationCurrent(operationVersion);
    const stored = storedMetadata?.accounts[0];
    const account: WalletAccount = {
      index: 0,
      path: IMPORTED_ACCOUNT_PATH,
      name: stored?.name ?? "Account 1",
      address,
      hidden: stored?.hidden ?? false,
      tokens: stored?.tokens ?? [],
      nfts: stored?.nfts ?? [],
    };
    if (!storedMetadata) {
      await this.storage.saveAccountMetadata(walletId, createImportedMetadata());
      this.assertOperationCurrent(operationVersion);
    }
    this.activateImportedWallet(account, normalizedKey);
  }

  /**
   * Starts a wallet session from a decrypted recovery phrase. Shared by the
   * password and biometric unlock paths so both restore exactly the same
   * accounts and selected account.
   */
  private async activateFromMnemonic(
    mnemonic: string,
    operationVersion: number,
    walletId: string,
  ): Promise<void> {
    if (!validateMnemonic(mnemonic)) {
      throw new Error("Stored vault does not contain a valid BIP-39 mnemonic");
    }

    const { account, seed } = await deriveAccountFromMnemonic(mnemonic, 0);
    try {
      this.assertOperationCurrent(operationVersion);
      const storedMetadata = await this.storage.loadAccountMetadata(walletId);
      this.assertOperationCurrent(operationVersion);
      const metadata = storedMetadata ?? createDefaultMetadata();
      const selectedPath = resolveSelectedPath(metadata);
      const accounts: WalletAccount[] = [];
      let selectedPrivateKey: Hex | null = null;
      for (const storedAccount of metadata.accounts) {
        const index = accountIndexFromPath(storedAccount.path);
        const derived = index === 0 ? account : deriveAccountAtIndex(seed, index);
        const walletAccount: WalletAccount = {
          index,
          path: storedAccount.path,
          name: storedAccount.name,
          address: derived.address,
          hidden: storedAccount.hidden,
          tokens: storedAccount.tokens ?? [],
          nfts: storedAccount.nfts ?? [],
        };
        accounts.push(walletAccount);
        if (storedAccount.path === selectedPath) {
          selectedPrivateKey = derived.privateKey;
        }
      }

      if (!storedMetadata || storedMetadata.selectedPath !== selectedPath) {
        await this.storage.saveAccountMetadata(walletId, {
          ...metadata,
          selectedPath,
        });
        this.assertOperationCurrent(operationVersion);
      }
      const selectedIndex = accountIndexFromPath(selectedPath);
      if (!selectedPrivateKey) {
        selectedPrivateKey = deriveAccountAtIndex(seed, selectedIndex).privateKey;
      }
      this.activateWallet(seed, accounts, selectedIndex, selectedPrivateKey);
    } catch (error) {
      seed.fill(0);
      throw error;
    }
  }

  lock(reason: LockReason = "manual"): void {
    this.lastLockReason = reason === "inactivity" ? "inactivity" : null;
    this.operationVersion += 1;
    this.accountMutationVersion += 1;
    this.accountMutationInProgress = false;
    this.nftOwnershipSyncInProgress = false;
    this.seed?.fill(0);
    this.seed = null;
    this.privateKeys.clear();
    this.updateState(false, [], null);
    this.pendingWallet?.seed.fill(0);
    this.pendingWallet = null;
  }

  /** Why the last session ended, so the unlock screen can explain an auto-lock. */
  getLockReason(): LockReason | null {
    return this.lastLockReason;
  }

  /**
   * Milliseconds until the selected wallet accepts another password attempt.
   * Used to restore the countdown after a reload; 0 means attempts are allowed.
   */
  getUnlockCooldownRemainingMs(): number {
    const walletId = this.registryLoaded ? this.registry.selectedId : null;
    return walletId ? this.unlockThrottle.retryAfterMs(walletId) : 0;
  }

  /** Whether a wrapped biometric vault exists for the selected wallet. */
  async hasBiometricUnlock(): Promise<boolean> {
    await this.ensureRegistry();
    const walletId = this.registry.selectedId;
    if (!walletId) return false;
    return (await this.storage.loadBiometricVault(walletId)) !== null;
  }

  /** Whether this browser can run a platform-authenticator ceremony. */
  async isBiometricUnlockAvailable(): Promise<boolean> {
    return this.biometric.isSupported();
  }

  /**
   * Enables Touch ID / Face ID unlock by re-confirming the password, creating a
   * PRF-capable passkey, and wrapping the recovery phrase under the passkey's
   * derived key. Nothing is stored unless the passkey yields a usable PRF.
   */
  async enableBiometricUnlock(password: string): Promise<void> {
    if (!this.state.isUnlocked) {
      throw new Error("Wallet is locked");
    }
    this.assertNoWalletCreationInProgress();
    const walletId = this.registry.selectedId;
    if (!walletId) {
      throw new Error("No wallet is stored on this device");
    }
    const operationVersion = this.operationVersion;
    const rpId = this.biometric.getRpId();
    if (!rpId) {
      throw new Error("Biometric unlock is not available in this browser");
    }
    if (!(await this.biometric.isSupported())) {
      throw new Error("Biometric unlock is not available on this device");
    }

    const vault = await this.storage.loadVault(walletId);
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }
    // Re-verify the password so the vault secret can be wrapped and the
    // enrollment cannot be triggered from a stale session. The secret is either
    // a recovery phrase or a private key; the wrapper only sees a string.
    const secretPayload = await decryptVault(vault, password);
    this.assertOperationCurrent(operationVersion);

    const prfSalt = createPrfSalt();
    const { credentialId, prfOutput } = await this.biometric.register({
      rpId,
      userName: this.state.address ?? "my-wallet",
      prfSalt,
    });
    this.assertOperationCurrent(operationVersion);

    let biometricVault: BiometricVault;
    try {
      biometricVault = await wrapMnemonic({
        mnemonic: secretPayload,
        prfOutput,
        credentialId,
        rpId,
        // The same salt used for the passkey ceremony, so unlock can
        // re-evaluate the identical PRF output.
        prfSalt,
      });
    } finally {
      prfOutput.fill(0);
    }
    this.assertOperationCurrent(operationVersion);
    await this.storage.saveBiometricVault(walletId, biometricVault);
  }

  /**
   * Removes the locally wrapped vault. The passkey itself stays in the OS
   * keychain; the user removes it there if they want it gone entirely.
   */
  async disableBiometricUnlock(): Promise<void> {
    await this.ensureRegistry();
    const walletId = this.registry.selectedId;
    if (!walletId) return;
    await this.storage.clearBiometricVault(walletId);
  }

  /**
   * Unlocks with Touch ID / Face ID. The passkey's PRF output decrypts the
   * wrapped recovery phrase, so no password is needed. The password path is
   * untouched and remains the fallback.
   */
  async unlockWithBiometric(): Promise<void> {
    this.assertNoWalletCreationInProgress();
    this.lock();
    const operationVersion = this.operationVersion;
    await this.ensureRegistry();
    this.assertOperationCurrent(operationVersion);
    const walletId = this.registry.selectedId;
    if (!walletId) {
      throw new Error("No wallet is stored on this device");
    }
    const vault = await this.storage.loadBiometricVault(walletId);
    this.assertOperationCurrent(operationVersion);
    if (!vault) {
      throw new Error("Biometric unlock is not set up on this device");
    }
    const rpId = this.biometric.getRpId();
    if (!rpId || rpId !== vault.rpId) {
      throw new Error("Biometric unlock must be set up again on this device");
    }

    const prfOutput = await this.biometric.evaluate({
      credentialId: vault.credentialId,
      prfSalt: decodeBase64(vault.prfSalt, "Biometric vault PRF salt"),
      rpId,
    });
    this.assertOperationCurrent(operationVersion);

    let secretPayload: string;
    try {
      secretPayload = await unwrapMnemonic(vault, prfOutput);
    } catch {
      throw new Error("Unable to decrypt the biometric vault");
    } finally {
      prfOutput.fill(0);
    }
    this.assertOperationCurrent(operationVersion);
    const secret = parseVaultSecret(secretPayload);
    if (secret.kind === "privateKey") {
      await this.activateFromPrivateKey(secret.secret, operationVersion, walletId);
    } else {
      await this.activateFromMnemonic(secret.secret, operationVersion, walletId);
    }
  }

  getAddress(): Address | null {
    return this.state.address;
  }

  /**
   * Reloads the wallet registry from storage. The list and selection are public
   * metadata (no key material), so they can be read while locked; the wallet
   * manager and the unlock screen call this on mount.
   */
  async refreshWallets(): Promise<void> {
    const registry = (await this.storage.loadRegistry()) ?? emptyRegistry();
    this.registry = registry;
    this.registryLoaded = true;
    this.updateState(
      this.state.isUnlocked,
      this.state.accounts,
      this.state.selectedAccountIndex,
    );
  }

  /**
   * Selects which wallet the UI targets for unlock. Switching away from the
   * unlocked wallet locks the session, because every wallet has its own
   * password.
   */
  async selectWallet(walletId: string): Promise<void> {
    await this.ensureRegistry();
    if (!this.registry.wallets.some((wallet) => wallet.id === walletId)) {
      throw new RangeError("Wallet does not exist on this device");
    }
    if (this.registry.selectedId === walletId) return;
    if (this.state.isUnlocked) this.lock();
    const registry: WalletRegistry = Object.freeze({
      ...this.registry,
      selectedId: walletId,
    });
    await this.storage.saveRegistry(registry);
    this.registry = registry;
    this.updateState(false, [], null);
  }

  /** Renames a wallet. The name is cosmetic and never touches the vault. */
  async renameWallet(walletId: string, name: string): Promise<void> {
    await this.ensureRegistry();
    if (!this.registry.wallets.some((wallet) => wallet.id === walletId)) {
      throw new RangeError("Wallet does not exist on this device");
    }
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || normalizedName.length > 32) {
      throw new RangeError("Wallet name must be between 1 and 32 characters");
    }
    const registry: WalletRegistry = Object.freeze({
      ...this.registry,
      wallets: this.registry.wallets.map((wallet) =>
        wallet.id === walletId ? { ...wallet, name: normalizedName } : wallet,
      ),
    });
    await this.storage.saveRegistry(registry);
    this.registry = registry;
    this.updateState(
      this.state.isUnlocked,
      this.state.accounts,
      this.state.selectedAccountIndex,
    );
  }

  /**
   * Deletes a wallet after re-verifying its password, wiping its vault, account
   * metadata, and biometric enrollment. Re-checking the password means an
   * unattended unlocked tab cannot destroy a wallet by a single click. If the
   * deleted wallet held the active session it is locked, and the selection moves
   * to a remaining wallet.
   */
  async deleteWallet(walletId: string, password: string): Promise<void> {
    await this.ensureRegistry();
    if (!this.registry.wallets.some((wallet) => wallet.id === walletId)) {
      throw new RangeError("Wallet does not exist on this device");
    }
    const vault = await this.storage.loadVault(walletId);
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }
    // A wrong password throws before anything is destroyed.
    await decryptVault(vault, password);

    const wasActive =
      this.state.isUnlocked && this.registry.selectedId === walletId;
    await this.storage.clearVault(walletId);

    const wallets = this.registry.wallets.filter(
      (wallet) => wallet.id !== walletId,
    );
    const selectedId =
      this.registry.selectedId === walletId
        ? (wallets[0]?.id ?? null)
        : this.registry.selectedId;
    const registry: WalletRegistry = Object.freeze({
      version: 1,
      wallets: Object.freeze(wallets),
      selectedId,
    });
    await this.storage.saveRegistry(registry);
    this.registry = registry;

    if (wasActive) {
      this.lock();
    } else {
      this.updateState(
        this.state.isUnlocked,
        this.state.accounts,
        this.state.selectedAccountIndex,
      );
    }
  }

  /**
   * Reveals one account's private key after re-verifying the vault password.
   *
   * The password is checked against the encrypted vault, so a wrong password
   * throws before any key material exists in memory. The key is re-derived from
   * the decrypted mnemonic rather than trusted from the in-memory map, and the
   * seed buffer is wiped before returning: only the exported hex string reaches
   * the caller.
   */
  async revealPrivateKey(index: number, password: string): Promise<Hex> {
    if (!this.state.isUnlocked) {
      throw new Error("Wallet is locked");
    }
    const account = this.state.accounts.find(
      (candidate) => candidate.index === index,
    );
    if (!account) {
      throw new RangeError("Account does not exist in this wallet session");
    }

    const walletId = this.registry.selectedId;
    if (!walletId) {
      throw new Error("No wallet is stored on this device");
    }
    const vault = await this.storage.loadVault(walletId);
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }
    const payload = await decryptVault(vault, password);
    const secret = parseVaultSecret(payload);
    if (secret.kind === "privateKey") {
      const key = normalizePrivateKey(secret.secret);
      if (addressFromPrivateKey(key) !== account.address) {
        throw new Error("Stored key does not match the account");
      }
      return key;
    }

    const seed = await mnemonicToSeed(secret.secret);
    try {
      const derived = deriveAccountAtIndex(seed, index);
      if (derived.address !== account.address) {
        throw new Error("Derived account does not match the stored account");
      }
      return derived.privateKey;
    } finally {
      seed.fill(0);
    }
  }

  async addAccount(): Promise<WalletAccount> {
    if (!this.state.isUnlocked) {
      throw new Error("Wallet is locked");
    }
    // An imported private key has no BIP-32 lineage, so it has exactly one
    // account and cannot derive more.
    if (
      this.state.accounts.some(
        (account) => account.path === IMPORTED_ACCOUNT_PATH,
      )
    ) {
      throw new Error("Imported-key wallets cannot add accounts");
    }
    if (!this.seed) {
      throw new Error("Wallet is locked");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const index = this.state.accounts.reduce(
        (nextIndex, account) => Math.max(nextIndex, account.index + 1),
        0,
      );
      if (index > MAX_ADDRESS_INDEX) {
        throw new RangeError("No more Ethereum account indexes are available");
      }
      const account = deriveAccountAtIndex(this.seed, index);
      const walletAccount = Object.freeze({
        ...createWalletAccount(index, account.address),
      });
      const accounts = [...this.state.accounts, walletAccount];
      await this.persistAccounts(accounts, index);
      this.assertOperationCurrent(operationVersion);
      this.privateKeys.set(index, account.privateKey);
      this.updateState(true, accounts, index);
      return walletAccount;
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async selectAccount(index: number): Promise<void> {
    if (!this.state.isUnlocked) {
      throw new Error("Wallet is locked");
    }
    const selectedAccount = this.state.accounts.find(
      (account) => account.index === index && !account.hidden,
    );
    if (!selectedAccount) {
      throw new RangeError("Account does not exist in this wallet session");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const privateKey = this.privateKeys.get(index);
      if (!privateKey && this.seed) {
        const derived = deriveAccountAtIndex(this.seed, index);
        this.privateKeys.set(index, derived.privateKey);
      }
      await this.persistAccounts(this.state.accounts, index);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, this.state.accounts, index);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
    void this.syncNftOwnership();
  }

  async renameAccount(index: number, name: string): Promise<void> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const account = this.state.accounts.find((candidate) => candidate.index === index);
    if (!account) throw new RangeError("Account does not exist in this wallet session");
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || normalizedName.length > 32) {
      throw new RangeError("Account name must be between 1 and 32 characters");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === index
          ? { ...candidate, name: normalizedName }
          : candidate,
      );
      await this.persistAccounts(accounts, this.state.selectedAccountIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, this.state.selectedAccountIndex);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async hideAccount(index: number): Promise<void> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const account = this.state.accounts.find((candidate) => candidate.index === index);
    if (!account) throw new RangeError("Account does not exist in this wallet session");
    if (account.hidden) return;

    const visibleAccounts = this.state.accounts.filter(
      (candidate) => !candidate.hidden && candidate.index !== index,
    );
    if (visibleAccounts.length === 0) {
      throw new Error("At least one account must remain visible");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const selectedIndex =
        this.state.selectedAccountIndex === index
          ? visibleAccounts[0]!.index
          : this.state.selectedAccountIndex;
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === index ? { ...candidate, hidden: true } : candidate,
      );
      await this.persistAccounts(accounts, selectedIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, selectedIndex);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async restoreAccount(index: number): Promise<void> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const account = this.state.accounts.find((candidate) => candidate.index === index);
    if (!account) throw new RangeError("Account does not exist in this wallet session");
    if (!account.hidden) return;
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === index ? { ...candidate, hidden: false } : candidate,
      );
      await this.persistAccounts(accounts, this.state.selectedAccountIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, this.state.selectedAccountIndex);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async addToken(address: string, chainId: number): Promise<StoredWalletToken> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const selectedIndex = this.state.selectedAccountIndex;
    const account = this.state.accounts.find(
      (candidate) => candidate.index === selectedIndex,
    );
    if (!account) throw new Error("Wallet is locked");
    const normalizedAddress = normalizeTokenAddress(address);
    if (
      account.tokens.some(
        (token) =>
          token.chainId === chainId &&
          token.address.toLowerCase() === normalizedAddress.toLowerCase(),
      )
    ) {
      throw new Error("This token is already in the selected account.");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const metadata = await this.readTokenMetadata(normalizedAddress, chainId);
      this.assertOperationCurrent(operationVersion);
      if (
        account.tokens.some(
          (token) =>
            token.chainId === chainId &&
            token.address.toLowerCase() === metadata.address.toLowerCase(),
        )
      ) {
        throw new Error("This token is already in the selected account.");
      }
      const token: StoredWalletToken = { ...metadata, hidden: false };
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === selectedIndex
          ? { ...candidate, tokens: [...candidate.tokens, token] }
          : candidate,
      );
      await this.persistAccounts(accounts, selectedIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, selectedIndex);
      return token;
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async hideToken(address: Address, chainId: number): Promise<void> {
    await this.setTokenVisibility(address, chainId, true);
  }

  async restoreToken(address: Address, chainId: number): Promise<void> {
    await this.setTokenVisibility(address, chainId, false);
  }

  async addNft(
    contractAddress: string,
    tokenIdInput: string,
    standard: NftStandard,
    chainId: number,
  ): Promise<StoredWalletNft> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    if (standard !== "ERC-721" && standard !== "ERC-1155") {
      throw new Error("Select ERC-721 or ERC-1155 as the NFT standard.");
    }
    const selectedIndex = this.state.selectedAccountIndex;
    const account = this.state.accounts.find(
      (candidate) => candidate.index === selectedIndex,
    );
    if (!account) throw new Error("Wallet is locked");
    const address = normalizeNftAddress(contractAddress);
    const tokenId = parseNftTokenId(tokenIdInput).toString();
    if (
      account.nfts.some(
        (nft) =>
          nft.chainId === chainId &&
          nft.address.toLowerCase() === address.toLowerCase() &&
          nft.tokenId === tokenId &&
          nft.standard === standard,
      )
    ) {
      throw new Error("This NFT is already listed in the selected account.");
    }

    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      await this.assertNftOwned(
        address,
        BigInt(tokenId),
        standard,
        account.address,
        chainId,
      );
      this.assertOperationCurrent(operationVersion);
      const nft = await this.readNftMetadata(
        address,
        BigInt(tokenId),
        standard,
        chainId,
      );
      this.assertOperationCurrent(operationVersion);
      const currentAccount = this.state.accounts.find(
        (candidate) => candidate.index === selectedIndex,
      );
      if (!currentAccount) throw new Error("Wallet is locked");
      if (
        currentAccount.nfts.some(
          (candidate) =>
            candidate.chainId === chainId &&
            candidate.address.toLowerCase() === address.toLowerCase() &&
            candidate.tokenId === tokenId &&
            candidate.standard === standard,
        )
      ) {
        throw new Error("This NFT is already listed in the selected account.");
      }
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === selectedIndex
          ? { ...candidate, nfts: [...candidate.nfts, nft] }
          : candidate,
      );
      await this.persistAccounts(accounts, selectedIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, selectedIndex);
      return nft;
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async removeNft(
    addressInput: Address,
    tokenIdInput: string,
    standard: NftStandard,
    chainId: number,
  ): Promise<void> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const selectedIndex = this.state.selectedAccountIndex;
    const selected = this.state.accounts.find(
      (candidate) => candidate.index === selectedIndex,
    );
    if (!selected) throw new Error("Wallet is locked");
    const address = normalizeNftAddress(addressInput);
    const tokenId = parseNftTokenId(tokenIdInput).toString();
    if (
      !selected.nfts.some(
        (nft) =>
          nft.chainId === chainId &&
          nft.address.toLowerCase() === address.toLowerCase() &&
          nft.tokenId === tokenId &&
          nft.standard === standard,
      )
    ) {
      throw new RangeError("NFT does not exist in this account");
    }
    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === selectedIndex
          ? {
              ...candidate,
              nfts: candidate.nfts.filter(
                (nft) =>
                  nft.chainId !== chainId ||
                  nft.address.toLowerCase() !== address.toLowerCase() ||
                  nft.tokenId !== tokenId ||
                  nft.standard !== standard,
              ),
            }
          : candidate,
      );
      await this.persistAccounts(accounts, selectedIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, selectedIndex);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  /**
   * Drops locally listed NFTs that this account definitively no longer owns.
   *
   * Runs after a wallet session starts (unlock / import) and whenever the
   * selected account changes or the NFT list is opened, so a token transferred
   * away in the meantime leaves the account on the next refresh.
   *
   * Pruning is deliberately fail-open: only a contract that answers "somebody
   * else owns it" (or an ERC-1155 balance of zero) removes an entry. A read that
   * fails for any reason — network trouble, a reverting `ownerOf` for a burned
   * token, a wrong standard tag — keeps the NFT, so a flaky RPC can never wipe
   * the stored list.
   *
   * Best-effort by design: it never rejects, because callers fire it without
   * awaiting. Awaiting the returned promise waits for the reconciliation.
   */
  async syncNftOwnership(
    chainId: number = this.getActiveChainId(),
  ): Promise<void> {
    if (this.nftOwnershipSyncInProgress) return;
    this.nftOwnershipSyncInProgress = true;
    try {
      if (!this.state.isUnlocked) return;
      const account = this.state.accounts.find(
        (candidate) => candidate.index === this.state.selectedAccountIndex,
      );
      if (!account) return;
      const chainNfts = account.nfts.filter((nft) => nft.chainId === chainId);
      if (chainNfts.length === 0) return;
      const operationVersion = this.operationVersion;

      // The network reads happen outside the mutation guard: a slow RPC must
      // never block the user from adding or removing an entry.
      const unowned = new Set<string>();
      for (const nft of chainNfts) {
        if (operationVersion !== this.operationVersion) return;
        try {
          const owned = await this.readNftOwnership(
            nft.address,
            BigInt(nft.tokenId),
            nft.standard,
            account.address,
            chainId,
          );
          if (!owned) unowned.add(nftIdentity(nft));
        } catch {
          // Unverifiable: keep the entry.
        }
      }
      if (unowned.size === 0) return;
      if (this.accountMutationInProgress) return;

      const mutationVersion = this.beginAccountMutation();
      try {
        // Re-read state and filter by identity so an NFT added while the reads
        // were in flight is not clobbered.
        const target = this.state.accounts.find(
          (candidate) => candidate.index === account.index,
        );
        if (!target) return;
        const kept = target.nfts.filter(
          (nft) => !unowned.has(nftIdentity(nft)),
        );
        if (kept.length === target.nfts.length) return;
        const accounts = this.state.accounts.map((candidate) =>
          candidate.index === account.index
            ? { ...candidate, nfts: kept }
            : candidate,
        );
        const selectedIndex = this.state.selectedAccountIndex;
        await this.persistAccounts(accounts, selectedIndex);
        if (operationVersion !== this.operationVersion) return;
        this.updateState(true, accounts, selectedIndex);
      } finally {
        this.finishAccountMutation(mutationVersion);
      }
    } catch {
      // Housekeeping only: a failed prune leaves the stored list untouched.
    } finally {
      this.nftOwnershipSyncInProgress = false;
    }
  }

  private async setTokenVisibility(
    address: Address,
    chainId: number,
    hidden: boolean,
  ): Promise<void> {
    if (!this.state.isUnlocked) throw new Error("Wallet is locked");
    const selectedIndex = this.state.selectedAccountIndex;
    const selected = this.state.accounts.find(
      (candidate) => candidate.index === selectedIndex,
    );
    if (!selected) throw new Error("Wallet is locked");
    const target = selected.tokens.find(
      (token) =>
        token.chainId === chainId &&
        token.address.toLowerCase() === address.toLowerCase(),
    );
    if (!target) throw new RangeError("Token does not exist in this account");
    if (target.hidden === hidden) return;

    const mutationVersion = this.beginAccountMutation();
    const operationVersion = this.operationVersion;
    try {
      const accounts = this.state.accounts.map((candidate) =>
        candidate.index === selectedIndex
          ? {
              ...candidate,
              tokens: candidate.tokens.map((token) =>
                token.chainId === chainId &&
                token.address.toLowerCase() === address.toLowerCase()
                  ? { ...token, hidden }
                  : token,
              ),
            }
          : candidate,
      );
      await this.persistAccounts(accounts, selectedIndex);
      this.assertOperationCurrent(operationVersion);
      this.updateState(true, accounts, selectedIndex);
    } finally {
      this.finishAccountMutation(mutationVersion);
    }
  }

  async signAndSendTransaction(tx: {
    from: Address;
    to: Address;
    value: bigint;
    chainId: number;
    estimate?: NativeTransferEstimate;
  }): Promise<Hash> {
    const selectedAccount = this.state.accounts.find(
      (account) => account.index === this.state.selectedAccountIndex,
    );
    if (!this.state.isUnlocked || !selectedAccount) {
      throw new Error("Wallet is locked");
    }
    if (tx.from !== selectedAccount.address) {
      throw new Error("Selected account changed. Review the transfer again.");
    }
    const privateKey = this.privateKeys.get(selectedAccount.index);
    if (!privateKey) {
      throw new Error("Wallet is locked");
    }
    return this.sendTransfer({
      to: tx.to,
      value: tx.value,
      chainId: tx.chainId,
      gas: tx.estimate?.gas,
      gasPrice: tx.estimate?.gasPrice,
      privateKey,
    });
  }

  /**
   * Signs and broadcasts an ERC-20 `transfer` for the selected account.
   *
   * Only tokens explicitly added to the selected account and still visible may
   * be sent: a hidden token is treated as unavailable, even though it remains
   * stored, so the send flow cannot target assets the user has hidden.
   */
  async signAndSendTokenTransfer(tx: {
    from: Address;
    token: Address;
    to: Address;
    amount: bigint;
    chainId: number;
    estimate?: Erc20TransferEstimate;
  }): Promise<Hash> {
    const selectedAccount = this.state.accounts.find(
      (account) => account.index === this.state.selectedAccountIndex,
    );
    if (!this.state.isUnlocked || !selectedAccount) {
      throw new Error("Wallet is locked");
    }
    if (tx.from !== selectedAccount.address) {
      throw new Error("Selected account changed. Review the transfer again.");
    }
    const token = selectedAccount.tokens.find(
      (candidate) =>
        candidate.chainId === tx.chainId &&
        candidate.address.toLowerCase() === tx.token.toLowerCase(),
    );
    if (!token || token.hidden) {
      throw new Error("This token is not available in the selected account.");
    }
    const privateKey = this.privateKeys.get(selectedAccount.index);
    if (!privateKey) {
      throw new Error("Wallet is locked");
    }
    return this.sendTokenTransfer({
      token: token.address,
      to: tx.to,
      amount: tx.amount,
      chainId: tx.chainId,
      gas: tx.estimate?.gas,
      gasPrice: tx.estimate?.gasPrice,
      privateKey,
    });
  }

  /**
   * Returns the EIP-7702 delegate set on the selected account, or `null` when
   * the account has no active delegation.
   */
  async getDelegatedAddress(chainId: number): Promise<Address | null> {
    const selectedAccount = this.state.accounts.find(
      (account) => account.index === this.state.selectedAccountIndex,
    );
    if (!this.state.isUnlocked || !selectedAccount) {
      throw new Error("Wallet is locked");
    }
    return this.readDelegatedAddress(selectedAccount.address, chainId);
  }

  /**
   * Revokes the selected account's EIP-7702 delegation by authorizing the zero
   * address and broadcasting the resulting type-4 transaction.
   *
   * The account both signs and pays for the transaction, so it must be part of
   * the unlocked session and the in-memory key must still be available.
   */
  async revokeAccountDelegation(chainId: number): Promise<Hash> {
    const selectedAccount = this.state.accounts.find(
      (account) => account.index === this.state.selectedAccountIndex,
    );
    if (!this.state.isUnlocked || !selectedAccount) {
      throw new Error("Wallet is locked");
    }
    const privateKey = this.privateKeys.get(selectedAccount.index);
    if (!privateKey) {
      throw new Error("Wallet is locked");
    }
    return this.revokeDelegation({
      address: selectedAccount.address,
      chainId,
      privateKey,
    });
  }

  private assertOperationCurrent(operationVersion: number): void {
    if (operationVersion !== this.operationVersion) {
      throw new Error("Wallet operation was cancelled");
    }
  }

  /**
   * Loads the wallet registry once per service lifetime. Lazy so the service
   * stays constructible outside a browser (the server has no `localStorage`)
   * and so tests can inject a fake storage.
   */
  private async ensureRegistry(): Promise<void> {
    if (this.registryLoaded) return;
    const registry = (await this.storage.loadRegistry()) ?? emptyRegistry();
    this.registry = registry;
    this.registryLoaded = true;
    this.updateState(
      this.state.isUnlocked,
      this.state.accounts,
      this.state.selectedAccountIndex,
    );
  }

  /**
   * The next free `<prefix> N` name, so defaults never collide after a delete.
   * HD wallets use "Wallet", imported-key wallets use "Imported key".
   */
  private nextWalletName(prefix = "Wallet"): string {
    const used = new Set(this.registry.wallets.map((wallet) => wallet.name));
    let index = 1;
    while (used.has(`${prefix} ${index}`)) index += 1;
    return `${prefix} ${index}`;
  }

  private async assertNftOwned(
    address: Address,
    tokenId: bigint,
    standard: NftStandard,
    owner: Address,
    chainId: number,
  ): Promise<void> {
    let owned: boolean;
    try {
      owned = await this.readNftOwnership(
        address,
        tokenId,
        standard,
        owner,
        chainId,
      );
    } catch (error) {
      throw new Error(
        `Could not verify NFT ownership. Confirm the contract, token ID, and standard, then retry.${
          error instanceof Error && error.message ? ` ${error.message}` : ""
        }`,
      );
    }
    if (!owned) {
      throw new Error("This account does not own that NFT token.");
    }
  }

  private assertNoWalletCreationInProgress(): void {
    if (this.walletCreationInProgress) {
      throw new Error("Wallet creation is already in progress");
    }
  }

  private activateWallet(
    seed: Uint8Array,
    accounts: readonly WalletAccount[],
    selectedIndex: number,
    privateKey: Hex,
  ): void {
    this.seed?.fill(0);
    this.seed = seed;
    this.privateKeys.clear();
    this.privateKeys.set(selectedIndex, privateKey);
    this.updateState(true, accounts, selectedIndex);
    // A wallet session just started: reconcile the stored NFT list against the
    // chain in the background (see syncNftOwnership).
    void this.syncNftOwnership();
  }

  /**
   * Starts a session for an imported-key wallet: no seed exists, and the single
   * account's key is the only entry in the in-memory key map.
   */
  private activateImportedWallet(account: WalletAccount, privateKey: Hex): void {
    this.seed?.fill(0);
    this.seed = null;
    this.privateKeys.clear();
    this.privateKeys.set(account.index, privateKey);
    this.updateState(true, [account], account.index);
    void this.syncNftOwnership();
  }

  private async persistAccounts(
    accounts: readonly WalletAccount[],
    selectedIndex: number | null,
  ): Promise<void> {
    const selected = accounts.find(
      (account) => account.index === selectedIndex && !account.hidden,
    );
    if (!selected) throw new Error("Select a visible account before saving");
    const walletId = this.registry.selectedId;
    if (!walletId) throw new Error("Wallet is locked");
    await this.storage.saveAccountMetadata(walletId, {
      version: 1,
      accounts: accounts.map(({ path, name, hidden, tokens, nfts }) => ({
        path,
        name,
        hidden,
        tokens,
        nfts,
      })),
      selectedPath: selected.path,
    });
  }

  private beginAccountMutation(): number {
    if (this.accountMutationInProgress) {
      throw new Error("Another account update is already in progress");
    }
    this.accountMutationInProgress = true;
    return this.accountMutationVersion;
  }

  private finishAccountMutation(mutationVersion: number): void {
    if (mutationVersion === this.accountMutationVersion) {
      this.accountMutationInProgress = false;
    }
  }

  private updateState(
    isUnlocked: boolean,
    accounts: readonly WalletAccount[],
    selectedAccountIndex: number | null,
  ): void {
    const selectedAccount =
      selectedAccountIndex === null
        ? undefined
        : accounts.find((account) => account.index === selectedAccountIndex);
    const address = selectedAccount?.address ?? null;
    if (
      this.state.isUnlocked === isUnlocked &&
      this.state.address === address &&
      this.state.selectedAccountIndex === selectedAccountIndex &&
      this.state.selectedWalletId === this.registry.selectedId &&
      this.state.wallets.length === this.registry.wallets.length &&
      this.state.wallets.every(
        (wallet, index) =>
          wallet.id === this.registry.wallets[index]?.id &&
          wallet.name === this.registry.wallets[index]?.name &&
          wallet.createdAt === this.registry.wallets[index]?.createdAt,
      ) &&
      this.state.accounts.length === accounts.length &&
      this.state.accounts.every(
        (account, index) =>
          account.index === accounts[index]?.index &&
          account.path === accounts[index]?.path &&
          account.name === accounts[index]?.name &&
          account.address === accounts[index]?.address &&
          account.hidden === accounts[index]?.hidden &&
          JSON.stringify(account.tokens) ===
            JSON.stringify(accounts[index]?.tokens) &&
          JSON.stringify(account.nfts) ===
            JSON.stringify(accounts[index]?.nfts),
      )
    ) {
      return;
    }
    const frozenAccounts = Object.freeze(
      accounts.map((account) =>
        Object.freeze({
          ...account,
          tokens: Object.freeze(
            account.tokens.map((token) => Object.freeze({ ...token })),
          ),
          nfts: Object.freeze(
            account.nfts.map((nft) => Object.freeze({ ...nft })),
          ),
        }),
      ),
    );
    this.state = Object.freeze({
      isUnlocked,
      address,
      accounts: frozenAccounts,
      selectedAccountIndex,
      wallets: Object.freeze(
        this.registry.wallets.map((wallet) => Object.freeze({ ...wallet })),
      ),
      selectedWalletId: this.registry.selectedId,
    });
    for (const listener of this.listeners) listener();
  }
}

async function deriveAccountFromMnemonic(mnemonic: string, index: number) {
  const seed = await mnemonicToSeed(mnemonic);
  try {
    return { account: deriveAccountAtIndex(seed, index), seed };
  } catch (error) {
    seed.fill(0);
    throw error;
  }
}

function nftIdentity(nft: StoredWalletNft): string {
  return `${nft.chainId}:${nft.address.toLowerCase()}:${nft.tokenId}:${nft.standard}`;
}

function emptyRegistry(): WalletRegistry {
  return Object.freeze({
    version: 1,
    wallets: Object.freeze([]),
    selectedId: null,
  });
}

function addWalletToRegistry(
  registry: WalletRegistry,
  wallet: StoredWalletSummary,
): WalletRegistry {
  return Object.freeze({
    version: 1,
    wallets: Object.freeze([...registry.wallets, wallet]),
    selectedId: wallet.id,
  });
}

/** Tokens stored for one account on one chain. */
export function selectAccountTokens(
  account: WalletAccount,
  chainId: number,
): readonly StoredWalletToken[] {
  return account.tokens.filter((token) => token.chainId === chainId);
}

/** NFTs stored for one account on one chain. */
export function selectAccountNfts(
  account: WalletAccount,
  chainId: number,
): readonly StoredWalletNft[] {
  return account.nfts.filter((nft) => nft.chainId === chainId);
}

function createWalletAccount(index: number, address: Address): WalletAccount {
  return {
    index,
    path: accountDerivationPath(index),
    name: `Account ${index + 1}`,
    address,
    hidden: false,
    tokens: [],
    nfts: [],
  };
}

/** The single account of an imported-key wallet: index 0, no derivation path. */
function createImportedAccount(address: Address): WalletAccount {
  return {
    index: 0,
    path: IMPORTED_ACCOUNT_PATH,
    name: "Account 1",
    address,
    hidden: false,
    tokens: [],
    nfts: [],
  };
}

/** Public metadata for a freshly imported-key wallet. */
function createImportedMetadata(): WalletAccountMetadata {
  return {
    version: 1,
    accounts: [
      {
        path: IMPORTED_ACCOUNT_PATH,
        name: "Account 1",
        hidden: false,
        tokens: [],
        nfts: [],
      },
    ],
    selectedPath: IMPORTED_ACCOUNT_PATH,
  };
}

function createDefaultMetadata(): WalletAccountMetadata {
  const path = accountDerivationPath(0);
  return {
    version: 1,
    accounts: [
      { path, name: "Account 1", hidden: false, tokens: [], nfts: [] },
    ],
    selectedPath: path,
  };
}

function resolveSelectedPath(metadata: WalletAccountMetadata): string {
  const selected = metadata.accounts.find(
    (account) => account.path === metadata.selectedPath && !account.hidden,
  );
  if (selected) return selected.path;
  const firstVisible =
    metadata.accounts.find(
      (account) => account.path === accountDerivationPath(0) && !account.hidden,
    ) ?? metadata.accounts.find((account) => !account.hidden);
  if (!firstVisible) throw new Error("No visible wallet accounts are available");
  return firstVisible.path;
}

function accountIndexFromPath(path: string): number {
  const match = /^m\/44'\/60'\/0'\/0\/(0|[1-9]\d*)$/.exec(path);
  if (!match) throw new Error("Stored account has an invalid derivation path");
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index) || accountDerivationPath(index) !== path) {
    throw new Error("Stored account has an invalid derivation path");
  }
  return index;
}

export const walletService = new WalletService();
