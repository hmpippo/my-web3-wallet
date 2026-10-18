import type { Address, Hash, Hex } from "viem";
import type {
  Erc20TransferEstimate,
  NativeTransferEstimate,
} from "./transaction-service";
import {
  decryptVault,
  encryptVault,
} from "@/core/crypto";
import {
  deriveAccountAtIndex,
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
  accountDerivationPath,
  MAX_ADDRESS_INDEX,
} from "@/core/hd-wallet";
import {
  storageService,
  type NftStandard,
  type StoredWalletNft,
  type StoredWalletToken,
  type StorageService,
  type WalletAccountMetadata,
} from "@/core/storage";
import { sendErc20Transfer, sendNativeTransfer } from "./transaction-service";
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

export interface WalletServiceDependencies {
  storage?: StorageService;
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
  /** Supplies the chain used by background work (NFT ownership sync). */
  getActiveChainId?: () => number;
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

  constructor(dependencies: WalletServiceDependencies = {}) {
    this.storage = dependencies.storage ?? storageService;
    this.sendTransfer = dependencies.sendTransfer ?? sendNativeTransfer;
    this.sendTokenTransfer =
      dependencies.sendTokenTransfer ?? sendErc20Transfer;
    this.readTokenMetadata = dependencies.readTokenMetadata ?? readTokenMetadata;
    this.readNftMetadata = dependencies.readNftMetadata ?? readNftMetadata;
    this.readNftOwnership = dependencies.readNftOwnership ?? readNftOwnership;
    this.getActiveChainId =
      dependencies.getActiveChainId ?? (() => chainService.activeChainId);
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
      const vault = await encryptVault(pendingWallet.mnemonic, password);
      this.assertOperationCurrent(operationVersion);
      if (await this.storage.hasVault()) {
        throw new Error("A wallet already exists on this device");
      }
      this.assertOperationCurrent(operationVersion);
      await this.storage.saveVault(vault);
      try {
        this.assertOperationCurrent(operationVersion);
        const account = pendingWallet.account;
        await this.storage.saveAccountMetadata({
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
        await this.storage.clearVault();
        throw error;
      }

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
      try {
        this.assertOperationCurrent(operationVersion);
        const walletAccount = createWalletAccount(0, account.address);
        await this.storage.saveAccountMetadata({
          version: 1,
          accounts: [
            { path: walletAccount.path, name: walletAccount.name, hidden: false },
          ],
          selectedPath: walletAccount.path,
        });
        this.assertOperationCurrent(operationVersion);
      } catch (error) {
        await this.storage.clearVault();
        throw error;
      }
      const walletAccount = createWalletAccount(0, account.address);
      this.activateWallet(seed, [walletAccount], 0, account.privateKey);
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
      const storedMetadata = await this.storage.loadAccountMetadata();
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
        await this.storage.saveAccountMetadata({
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

  lock(): void {
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

  getAddress(): Address | null {
    return this.state.address;
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

    const vault = await this.storage.loadVault();
    if (!vault) {
      throw new Error("No wallet is stored on this device");
    }
    const mnemonic = await decryptVault(vault, password);
    const seed = await mnemonicToSeed(mnemonic);
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
    if (!this.state.isUnlocked || !this.seed) {
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

  private assertOperationCurrent(operationVersion: number): void {
    if (operationVersion !== this.operationVersion) {
      throw new Error("Wallet operation was cancelled");
    }
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

  private async persistAccounts(
    accounts: readonly WalletAccount[],
    selectedIndex: number | null,
  ): Promise<void> {
    const selected = accounts.find(
      (account) => account.index === selectedIndex && !account.hidden,
    );
    if (!selected) throw new Error("Select a visible account before saving");
    await this.storage.saveAccountMetadata({
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
