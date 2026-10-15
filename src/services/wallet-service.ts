import type { Address, Hash, Hex } from "viem";
import {
  decryptVault,
  encryptVault,
} from "@/core/crypto";
import {
  deriveAccount,
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "@/core/hd-wallet";
import { storageService, type StorageService } from "@/core/storage";
import { sendNativeTransfer } from "./transaction-service";

export interface WalletState {
  isUnlocked: boolean;
  address: Address | null;
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
  }) => Promise<Hash>;
}

interface PendingWallet extends PreparedWallet {
  privateKey: Hex;
}

export class WalletService {
  private privateKey: Hex | null = null;
  private address: Address | null = null;
  private pendingWallet: PendingWallet | null = null;
  private operationVersion = 0;
  private walletCreationInProgress = false;
  private readonly storage: StorageService;
  private readonly sendTransfer: NonNullable<
    WalletServiceDependencies["sendTransfer"]
  >;

  constructor(dependencies: WalletServiceDependencies = {}) {
    this.storage = dependencies.storage ?? storageService;
    this.sendTransfer = dependencies.sendTransfer ?? sendNativeTransfer;
  }

  get isUnlocked(): boolean {
    return this.privateKey !== null;
  }

  getState(): WalletState {
    return {
      isUnlocked: this.isUnlocked,
      address: this.address,
    };
  }

  async prepareWallet(): Promise<PreparedWallet> {
    this.assertNoWalletCreationInProgress();
    if (await this.storage.hasVault()) {
      throw new Error("A wallet already exists on this device");
    }
    this.lock();
    const operationVersion = this.operationVersion;

    const mnemonic = generateMnemonic();
    const account = await deriveAccountFromMnemonic(mnemonic);
    this.assertOperationCurrent(operationVersion);
    this.pendingWallet = {
      mnemonic,
      address: account.address,
      privateKey: account.privateKey,
    };
    return { mnemonic, address: account.address };
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

      this.privateKey = pendingWallet.privateKey;
      this.address = pendingWallet.address;
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
    if (await this.storage.hasVault()) {
      throw new Error("A wallet already exists on this device");
    }

    this.lock();
    const operationVersion = this.operationVersion;
    const normalizedMnemonic = mnemonic.trim().split(/\s+/).join(" ");
    const account = await deriveAccountFromMnemonic(normalizedMnemonic);
    this.assertOperationCurrent(operationVersion);
    const vault = await encryptVault(normalizedMnemonic, password);
    this.assertOperationCurrent(operationVersion);
    if (await this.storage.hasVault()) {
      throw new Error("A wallet already exists on this device");
    }
    this.assertOperationCurrent(operationVersion);
    await this.storage.saveVault(vault);
    this.assertOperationCurrent(operationVersion);

    this.privateKey = account.privateKey;
    this.address = account.address;
    return account.address;
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

    const account = await deriveAccountFromMnemonic(mnemonic);
    this.assertOperationCurrent(operationVersion);
    this.privateKey = account.privateKey;
    this.address = account.address;
  }

  lock(): void {
    this.operationVersion += 1;
    this.privateKey = null;
    this.address = null;
    this.pendingWallet = null;
  }

  getAddress(): Address | null {
    return this.address;
  }

  async signAndSendTransaction(tx: {
    to: Address;
    value: bigint;
  }): Promise<Hash> {
    const privateKey = this.privateKey;
    if (!privateKey) {
      throw new Error("Wallet is locked");
    }
    return this.sendTransfer({ ...tx, privateKey });
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
}

async function deriveAccountFromMnemonic(mnemonic: string) {
  const seed = await mnemonicToSeed(mnemonic);
  try {
    return deriveAccount(seed);
  } finally {
    seed.fill(0);
  }
}

export const walletService = new WalletService();
