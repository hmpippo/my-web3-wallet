import type { Address, Hash, Hex } from "viem";
import type { NativeTransferEstimate } from "./transaction-service";
import {
  decryptVault,
  encryptVault,
} from "@/core/crypto";
import {
  deriveAccountAtIndex,
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "@/core/hd-wallet";
import { storageService, type StorageService } from "@/core/storage";
import { sendNativeTransfer } from "./transaction-service";

export interface WalletState {
  readonly isUnlocked: boolean;
  readonly address: Address | null;
  readonly accounts: readonly WalletAccount[];
  readonly selectedAccountIndex: number | null;
}

export interface WalletAccount {
  readonly index: number;
  readonly address: Address;
}

export interface PreparedWallet {
  mnemonic: string;
  address: Address;
}

export interface WalletServiceDependencies {
  storage?: StorageService;
  sendTransfer?: (params: {
    to: Address;
    value: bigint;
    privateKey: Hex;
    gas?: bigint;
    gasPrice?: bigint;
  }) => Promise<Hash>;
}

interface PendingWallet extends PreparedWallet {
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
  });
  private pendingWallet: PendingWallet | null = null;
  private operationVersion = 0;
  private walletCreationInProgress = false;
  private readonly listeners = new Set<() => void>();
  private readonly storage: StorageService;
  private readonly sendTransfer: NonNullable<
    WalletServiceDependencies["sendTransfer"]
  >;

  constructor(dependencies: WalletServiceDependencies = {}) {
    this.storage = dependencies.storage ?? storageService;
    this.sendTransfer = dependencies.sendTransfer ?? sendNativeTransfer;
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
    this.lock();
    const operationVersion = this.operationVersion;
    if (await this.storage.hasVault()) {
      this.assertOperationCurrent(operationVersion);
      throw new Error("A wallet already exists on this device");
    }
    this.assertOperationCurrent(operationVersion);

    const mnemonic = generateMnemonic();
    const { account, seed } = await deriveAccountFromMnemonic(mnemonic, 0);
    try {
      this.assertOperationCurrent(operationVersion);
      this.pendingWallet = {
        mnemonic,
        address: account.address,
        account: { index: 0, address: account.address },
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
      const vault = await encryptVault(pendingWallet.mnemonic, password);
      this.assertOperationCurrent(operationVersion);
      if (await this.storage.hasVault()) {
        throw new Error("A wallet already exists on this device");
      }
      this.assertOperationCurrent(operationVersion);
      await this.storage.saveVault(vault);
      this.assertOperationCurrent(operationVersion);

      this.activateWallet(
        pendingWallet.seed,
        pendingWallet.account,
        pendingWallet.privateKey,
      );
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
    this.lock();
    const operationVersion = this.operationVersion;
    if (await this.storage.hasVault()) {
      this.assertOperationCurrent(operationVersion);
      throw new Error("A wallet already exists on this device");
    }
    this.assertOperationCurrent(operationVersion);

    const normalizedMnemonic = mnemonic.trim().split(/\s+/).join(" ");
    const { account, seed } = await deriveAccountFromMnemonic(normalizedMnemonic, 0);
    let seedTransferred = false;
    try {
      this.assertOperationCurrent(operationVersion);
      const vault = await encryptVault(normalizedMnemonic, password);
      this.assertOperationCurrent(operationVersion);
      if (await this.storage.hasVault()) {
        throw new Error("A wallet already exists on this device");
      }
      this.assertOperationCurrent(operationVersion);
      await this.storage.saveVault(vault);
      this.assertOperationCurrent(operationVersion);

      const walletAccount = { index: 0, address: account.address };
      this.activateWallet(seed, walletAccount, account.privateKey);
      seedTransferred = true;
      return account.address;
    } finally {
      if (!seedTransferred) seed.fill(0);
    }
  }

  async unlock(password: string): Promise<void> {
    this.assertNoWalletCreationInProgress();
    this.lock();
    const operationVersion = this.operationVersion;
    const vault = await this.storage.loadVault();
    this.assertOperationCurrent(operationVersion);
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }

    const mnemonic = await decryptVault(vault, password);
    this.assertOperationCurrent(operationVersion);
    if (!validateMnemonic(mnemonic)) {
      throw new Error("Stored vault does not contain a valid BIP-39 mnemonic");
    }

    const { account, seed } = await deriveAccountFromMnemonic(mnemonic, 0);
    try {
      this.assertOperationCurrent(operationVersion);
      this.activateWallet(
        seed,
        { index: 0, address: account.address },
        account.privateKey,
      );
    } catch (error) {
      seed.fill(0);
      throw error;
    }
  }

  lock(): void {
    this.operationVersion += 1;
    this.seed?.fill(0);
    this.seed = null;
    this.privateKeys.clear();
    this.updateState(false, [], null);
    this.pendingWallet?.seed.fill(0);
    this.pendingWallet = null;
  }

  getAddress(): Address | null {
    return this.state.address;
  }

  addAccount(): WalletAccount {
    if (!this.state.isUnlocked || !this.seed) {
      throw new Error("Wallet is locked");
    }
    const index = this.state.accounts.length;
    const account = deriveAccountAtIndex(this.seed, index);
    const walletAccount = Object.freeze({ index, address: account.address });
    this.privateKeys.set(index, account.privateKey);
    this.updateState(true, [...this.state.accounts, walletAccount], index);
    return walletAccount;
  }

  selectAccount(index: number): void {
    if (!this.state.isUnlocked) {
      throw new Error("Wallet is locked");
    }
    if (!this.state.accounts.some((account) => account.index === index)) {
      throw new RangeError("Account does not exist in this wallet session");
    }
    this.updateState(true, this.state.accounts, index);
  }

  async signAndSendTransaction(tx: {
    from: Address;
    to: Address;
    value: bigint;
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
      gas: tx.estimate?.gas,
      gasPrice: tx.estimate?.gasPrice,
      privateKey,
    });
  }

  private assertOperationCurrent(operationVersion: number): void {
    if (operationVersion !== this.operationVersion) {
      throw new Error("Wallet operation was cancelled");
    }
  }

  private assertNoWalletCreationInProgress(): void {
    if (this.walletCreationInProgress) {
      throw new Error("Wallet creation is already in progress");
    }
  }

  private activateWallet(
    seed: Uint8Array,
    account: WalletAccount,
    privateKey: Hex,
  ): void {
    this.seed?.fill(0);
    this.seed = seed;
    this.privateKeys.clear();
    this.privateKeys.set(account.index, privateKey);
    this.updateState(true, [account], account.index);
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
      this.state.accounts.length === accounts.length &&
      this.state.accounts.every(
        (account, index) =>
          account.index === accounts[index]?.index &&
          account.address === accounts[index]?.address,
      )
    ) {
      return;
    }
    const frozenAccounts = Object.freeze(
      accounts.map((account) => Object.freeze({ ...account })),
    );
    this.state = Object.freeze({
      isUnlocked,
      address,
      accounts: frozenAccounts,
      selectedAccountIndex,
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

export const walletService = new WalletService();
