import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encryptVault,
  VaultDecryptionError,
  type EncryptedVault,
} from "@/core/crypto";
import { deriveAccountAtIndex, mnemonicToSeed } from "@/core/hd-wallet";
import type { BiometricVault } from "@/core/biometric-vault";
import { decodeBase64 } from "@/lib/base64";
import type {
  StorageService,
  WalletAccountMetadata,
  WalletRegistry,
} from "@/core/storage";
import { WalletService, type BiometricUnlockProvider } from "./wallet-service";
import { UnlockThrottledError } from "@/lib/unlock-throttle";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SECOND_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DEFAULT_WALLET_ID = "wallet-test-1";
const LOCKED_STATE = {
  isUnlocked: false,
  address: null,
  accounts: [],
  selectedAccountIndex: null,
};
const SEPOLIA = 11155111;

function seedRegistry(): WalletRegistry {
  return {
    version: 1,
    wallets: [{ id: DEFAULT_WALLET_ID, name: "Wallet 1", createdAt: 0 }],
    selectedId: DEFAULT_WALLET_ID,
  };
}

function createStorage(
  initialVault: EncryptedVault | null = null,
  initialMetadata: WalletAccountMetadata | null = null,
  initialBiometricVault: BiometricVault | null = null,
  initialRegistry: WalletRegistry | null = null,
) {
  const vaults = new Map<string, EncryptedVault>();
  const accountMetadata = new Map<string, WalletAccountMetadata>();
  const biometricVaults = new Map<string, BiometricVault>();
  // A pre-seeded vault belongs to a registered wallet, matching the real
  // invariant that key material is only reachable through the registry.
  let registry =
    initialRegistry ??
    (initialVault || initialMetadata || initialBiometricVault
      ? seedRegistry()
      : null);
  if (initialVault) vaults.set(DEFAULT_WALLET_ID, initialVault);
  if (initialMetadata) accountMetadata.set(DEFAULT_WALLET_ID, initialMetadata);
  if (initialBiometricVault) {
    biometricVaults.set(DEFAULT_WALLET_ID, initialBiometricVault);
  }
  const storage: StorageService = {
    saveRegistry: vi.fn(async (value) => {
      registry = value;
    }),
    loadRegistry: vi.fn(async () => registry),
    clearRegistry: vi.fn(async () => {
      registry = null;
    }),
    saveVault: vi.fn(async (walletId, value) => {
      vaults.set(walletId, value);
    }),
    loadVault: vi.fn(async (walletId) => vaults.get(walletId) ?? null),
    clearVault: vi.fn(async (walletId) => {
      vaults.delete(walletId);
      accountMetadata.delete(walletId);
      biometricVaults.delete(walletId);
    }),
    hasVault: vi.fn(async (walletId) => vaults.has(walletId)),
    saveAccountMetadata: vi.fn(async (walletId, value) => {
      accountMetadata.set(walletId, value);
    }),
    loadAccountMetadata: vi.fn(
      async (walletId) => accountMetadata.get(walletId) ?? null,
    ),
    clearAccountMetadata: vi.fn(async (walletId) => {
      accountMetadata.delete(walletId);
    }),
    saveBiometricVault: vi.fn(async (walletId, value) => {
      biometricVaults.set(walletId, value);
    }),
    loadBiometricVault: vi.fn(
      async (walletId) => biometricVaults.get(walletId) ?? null,
    ),
    clearBiometricVault: vi.fn(async (walletId) => {
      biometricVaults.delete(walletId);
    }),
  };
  return {
    storage,
    getVault: () => [...vaults.values()][0] ?? null,
    getAccountMetadata: () => [...accountMetadata.values()][0] ?? null,
    getBiometricVault: () => [...biometricVaults.values()][0] ?? null,
    getRegistry: () => registry,
  };
}

describe("WalletService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit backup confirmation before persisting a new wallet", async () => {
    const { storage, getVault } = createStorage();
    const service = new WalletService({ storage });
    const prepared = await service.prepareWallet();

    expect(prepared.mnemonic.split(" ")).toHaveLength(12);
    expect(service.getState()).toMatchObject(LOCKED_STATE);
    expect(getVault()).toBeNull();

    await expect(service.createWallet("correct horse", false)).rejects.toThrow(
      "Confirm that you have backed up",
    );
    expect(storage.saveVault).not.toHaveBeenCalled();

    const created = await service.createWallet("correct horse", true);
    expect(created).toEqual(prepared);
    expect(service.getState()).toMatchObject({
      isUnlocked: true,
      address: prepared.address,
      accounts: [
        {
          index: 0,
          path: "m/44'/60'/0'/0/0",
          name: "Account 1",
          address: prepared.address,
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
      selectedAccountIndex: 0,
    });
    expect(getVault()).not.toBeNull();
    expect(JSON.stringify(getVault())).not.toContain(prepared.mnemonic);
  });

  it("requires prepareWallet before wallet creation", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(service.createWallet("correct horse", true)).rejects.toThrow(
      "Prepare a wallet",
    );
  });

  it("exposes immutable state and notifies subscribers on transitions", async () => {
    const service = new WalletService({ storage: createStorage().storage });
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    const lockedState = service.getState();

    expect(Object.isFrozen(lockedState)).toBe(true);
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    expect(Object.isFrozen(service.getState().accounts)).toBe(true);
    expect(Object.isFrozen(service.getState().accounts[0])).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getState().isUnlocked).toBe(true);

    service.lock();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(service.getState()).toMatchObject(LOCKED_STATE);
    unsubscribe();
  });

  it("clears the prepared recovery phrase when locked", async () => {
    const { storage } = createStorage();
    const service = new WalletService({ storage });

    await service.prepareWallet();
    service.lock();

    await expect(service.createWallet("correct horse", true)).rejects.toThrow(
      "Prepare a wallet",
    );
    expect(storage.saveVault).not.toHaveBeenCalled();
  });

  it("imports a mnemonic and derives the same address after unlock", async () => {
    const { storage, getVault } = createStorage();
    const service = new WalletService({ storage });

    await expect(
      service.importWallet(TEST_MNEMONIC, "correct horse"),
    ).resolves.toBe(EXPECTED_ADDRESS);
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
    expect(JSON.stringify(getVault())).not.toContain(TEST_MNEMONIC);

    service.lock();
    expect(service.getState()).toMatchObject(LOCKED_STATE);
    await service.unlock("correct horse");
    expect(service.getState()).toMatchObject({
      isUnlocked: true,
      address: EXPECTED_ADDRESS,
      accounts: [
        {
          index: 0,
          path: "m/44'/60'/0'/0/0",
          name: "Account 1",
          address: EXPECTED_ADDRESS,
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
      selectedAccountIndex: 0,
    });
  });

  it("rejects invalid phrases and keeps existing wallets when adding another", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse");
    const { storage, getRegistry } = createStorage(vault);
    const service = new WalletService({ storage });

    await expect(
      service.importWallet("not a valid phrase", "correct horse"),
    ).rejects.toThrow("Invalid BIP-39 mnemonic");
    expect(storage.saveVault).not.toHaveBeenCalled();

    // Importing a valid phrase adds a second wallet next to the existing one.
    await service.importWallet(TEST_MNEMONIC, "a different password");
    expect(getRegistry()?.wallets).toHaveLength(2);
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
  });

  it("fails to unlock for a wrong password and stays locked", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse");
    const service = new WalletService({ storage: createStorage(vault).storage });

    await expect(service.unlock("wrong password")).rejects.toThrow(
      "Unable to decrypt vault",
    );
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("fails when no vault exists", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(service.unlock("correct horse")).rejects.toThrow(
      "No wallet is stored",
    );
  });

  it("reveals an account's private key only after verifying the password", async () => {
    const service = new WalletService({ storage: createStorage().storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addAccount();

    const seed = await mnemonicToSeed(TEST_MNEMONIC);
    const expected = deriveAccountAtIndex(seed, 1).privateKey;
    seed.fill(0);

    await expect(service.revealPrivateKey(1, "correct horse")).resolves.toBe(
      expected,
    );
  });

  it("refuses to reveal a key for a wrong password, unknown account, or while locked", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(service.revealPrivateKey(0, "correct horse")).rejects.toThrow(
      "Wallet is locked",
    );

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(
      service.revealPrivateKey(0, "wrong password"),
    ).rejects.toThrow("Unable to decrypt vault");
    await expect(service.revealPrivateKey(5, "correct horse")).rejects.toThrow(
      "Account does not exist",
    );
  });

  it("only signs and sends while unlocked", async () => {
    const sendTransfer = vi.fn(async () => "0x1234" as `0x${string}`);
    const service = new WalletService({
      storage: createStorage().storage,
      sendTransfer,
    });
    const transaction = {
      from: EXPECTED_ADDRESS as `0x${string}`,
      to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      value: BigInt(1),
      chainId: SEPOLIA,
    };
    const estimate = {
      gas: BigInt(21_000),
      gasPrice: BigInt(10),
      estimatedFee: BigInt(210_000),
    };

    await expect(service.signAndSendTransaction(transaction)).rejects.toThrow(
      "Wallet is locked",
    );
    expect(sendTransfer).not.toHaveBeenCalled();

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(
      service.signAndSendTransaction({ ...transaction, estimate }),
    ).resolves.toBe("0x1234");
    expect(sendTransfer).toHaveBeenCalledWith({
      to: transaction.to,
      value: transaction.value,
      chainId: SEPOLIA,
      gas: estimate.gas,
      gasPrice: estimate.gasPrice,
      privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });

    service.lock();
    await expect(service.signAndSendTransaction(transaction)).rejects.toThrow(
      "Wallet is locked",
    );
    expect(sendTransfer).toHaveBeenCalledTimes(1);
  });

  it("does not unlock after an in-flight unlock is cancelled by lock", async () => {
    const { storage } = createStorage(
      await encryptVault(TEST_MNEMONIC, "correct horse"),
    );
    const service = new WalletService({ storage });
    const unlockPromise = service.unlock("correct horse");

    service.lock();

    await expect(unlockPromise).rejects.toThrow("Wallet operation was cancelled");
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("persists accounts and selected account across lock and unlock", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    const second = await service.addAccount();
    expect(second).toEqual({
      index: 1,
      path: "m/44'/60'/0'/0/1",
      name: "Account 2",
      address: SECOND_ADDRESS,
      hidden: false,
      tokens: [],
      nfts: [],
    });
    expect(service.getState()).toMatchObject({
      isUnlocked: true,
      address: SECOND_ADDRESS,
      accounts: [
        {
          index: 0,
          path: "m/44'/60'/0'/0/0",
          name: "Account 1",
          address: EXPECTED_ADDRESS,
          hidden: false,
          tokens: [],
          nfts: [],
        },
        second,
      ],
      selectedAccountIndex: 1,
    });

    await service.selectAccount(0);
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
    await service.selectAccount(1);
    expect(service.getAddress()).toBe(SECOND_ADDRESS);
    expect(getAccountMetadata()?.selectedPath).toBe("m/44'/60'/0'/0/1");

    service.lock();
    expect(service.getState()).toMatchObject(LOCKED_STATE);
    await service.unlock("correct horse");
    expect(service.getState()).toMatchObject({
      isUnlocked: true,
      address: SECOND_ADDRESS,
      accounts: [
        {
          index: 0,
          path: "m/44'/60'/0'/0/0",
          name: "Account 1",
          address: EXPECTED_ADDRESS,
          hidden: false,
          tokens: [],
          nfts: [],
        },
        {
          index: 1,
          path: "m/44'/60'/0'/0/1",
          name: "Account 2",
          address: SECOND_ADDRESS,
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
      selectedAccountIndex: 1,
    });
  });

  it("uses the selected account key to sign and rejects a changed account", async () => {
    const sendTransfer = vi.fn(async () => "0x1234" as `0x${string}`);
    const service = new WalletService({
      storage: createStorage().storage,
      sendTransfer,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addAccount();
    const transaction = {
      from: SECOND_ADDRESS as `0x${string}`,
      to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      value: BigInt(1),
      chainId: SEPOLIA,
    };
    await service.signAndSendTransaction(transaction);
    const seed = await mnemonicToSeed(TEST_MNEMONIC);
    const expectedPrivateKey = deriveAccountAtIndex(seed, 1).privateKey;
    seed.fill(0);

    expect(sendTransfer).toHaveBeenLastCalledWith({
      to: transaction.to,
      value: transaction.value,
      chainId: SEPOLIA,
      gas: undefined,
      gasPrice: undefined,
      privateKey: expectedPrivateKey,
    });

    await service.selectAccount(0);
    await expect(service.signAndSendTransaction(transaction)).rejects.toThrow(
      "Selected account changed",
    );
    expect(sendTransfer).toHaveBeenCalledTimes(1);
  });

  it("only signs and sends ERC-20 transfers for tokens added and visible in the account", async () => {
    const sendTokenTransfer = vi.fn(async () => "0xabc" as `0x${string}`);
    const readTokenMetadata = vi.fn(
      async (address: `0x${string}`, chainId: number) => ({
        chainId,
        address,
        name: "Test Token",
        symbol: "TST",
        decimals: 6,
      }),
    );
    const service = new WalletService({
      storage: createStorage().storage,
      sendTokenTransfer,
      readTokenMetadata,
    });
    const token = "0x0000000000000000000000000000000000000009" as `0x${string}`;
    const transfer = {
      from: EXPECTED_ADDRESS as `0x${string}`,
      token,
      to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      amount: BigInt(1_000),
      chainId: SEPOLIA,
    };
    const estimate = {
      gas: BigInt(60_000),
      gasPrice: BigInt(10),
      estimatedFee: BigInt(600_000),
    };

    await expect(service.signAndSendTokenTransfer(transfer)).rejects.toThrow(
      "Wallet is locked",
    );
    expect(sendTokenTransfer).not.toHaveBeenCalled();

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(service.signAndSendTokenTransfer(transfer)).rejects.toThrow(
      "not available",
    );
    expect(sendTokenTransfer).not.toHaveBeenCalled();

    await service.addToken(token, SEPOLIA);
    await expect(
      service.signAndSendTokenTransfer({ ...transfer, estimate }),
    ).resolves.toBe("0xabc");
    expect(sendTokenTransfer).toHaveBeenCalledWith({
      token,
      to: transfer.to,
      amount: transfer.amount,
      chainId: SEPOLIA,
      gas: estimate.gas,
      gasPrice: estimate.gasPrice,
      privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });

    await service.hideToken(token, SEPOLIA);
    await expect(service.signAndSendTokenTransfer(transfer)).rejects.toThrow(
      "not available",
    );
    expect(sendTokenTransfer).toHaveBeenCalledTimes(1);
  });

  it("rejects an ERC-20 transfer when the selected account changed", async () => {
    const sendTokenTransfer = vi.fn(async () => "0xabc" as `0x${string}`);
    const readTokenMetadata = vi.fn(
      async (address: `0x${string}`, chainId: number) => ({
        chainId,
        address,
        name: "Test Token",
        symbol: "TST",
        decimals: 6,
      }),
    );
    const service = new WalletService({
      storage: createStorage().storage,
      sendTokenTransfer,
      readTokenMetadata,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    const token = "0x0000000000000000000000000000000000000009" as `0x${string}`;
    await service.addToken(token, SEPOLIA);
    await service.addAccount();

    await expect(
      service.signAndSendTokenTransfer({
        from: EXPECTED_ADDRESS as `0x${string}`,
        token,
        to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        amount: BigInt(1),
        chainId: SEPOLIA,
      }),
    ).rejects.toThrow("Selected account changed");
    expect(sendTokenTransfer).not.toHaveBeenCalled();
  });

  it("renames, hides, restores, and keeps hidden derivation indexes reserved", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    const second = await service.addAccount();
    const third = await service.addAccount();

    await service.selectAccount(second.index);
    await service.renameAccount(second.index, "Savings");
    await service.hideAccount(second.index);

    expect(service.getState().selectedAccountIndex).toBe(0);
    expect(service.getState().accounts[1]).toMatchObject({
      name: "Savings",
      hidden: true,
    });
    expect(getAccountMetadata()?.accounts[1]).toMatchObject({
      path: "m/44'/60'/0'/0/1",
      name: "Savings",
      hidden: true,
    });

    await service.hideAccount(0);
    expect(service.getState().selectedAccountIndex).toBe(third.index);
    await expect(service.hideAccount(third.index)).rejects.toThrow(
      "At least one account must remain visible",
    );
    await expect(service.selectAccount(second.index)).rejects.toThrow(
      "Account does not exist",
    );

    await service.restoreAccount(0);
    await service.restoreAccount(second.index);
    expect(service.getState().accounts[1]?.hidden).toBe(false);

    await service.hideAccount(second.index);
    service.lock();
    await service.unlock("correct horse");
    expect(service.getState().accounts.map(({ index, hidden, name }) => ({
      index,
      hidden,
      name,
    }))).toEqual([
      { index: 0, hidden: false, name: "Account 1" },
      { index: 1, hidden: true, name: "Savings" },
      { index: 2, hidden: false, name: "Account 3" },
    ]);
    expect(service.getState().selectedAccountIndex).toBe(third.index);

    const fourth = await service.addAccount();
    expect(fourth.index).toBe(3);
  });

  it("migrates an existing vault without account metadata to account 1", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse");
    const { storage, getAccountMetadata } = createStorage(vault);
    const service = new WalletService({ storage });

    await service.unlock("correct horse");

    expect(service.getState().selectedAccountIndex).toBe(0);
    expect(service.getState().accounts).toHaveLength(1);
    expect(getAccountMetadata()?.accounts).toEqual([
      {
        path: "m/44'/60'/0'/0/0",
        name: "Account 1",
        hidden: false,
        tokens: [],
        nfts: [],
      },
    ]);
  });

  it("restores a visible account when the persisted selection is hidden or stale", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse");
    const metadata: WalletAccountMetadata = {
      version: 1,
      accounts: [
        { path: "m/44'/60'/0'/0/0", name: "Home", hidden: false },
        { path: "m/44'/60'/0'/0/1", name: "Hidden savings", hidden: true },
      ],
      selectedPath: "m/44'/60'/0'/0/1",
    };
    const { storage, getAccountMetadata } = createStorage(vault, metadata);
    const service = new WalletService({ storage });

    await service.unlock("correct horse");

    expect(service.getState().selectedAccountIndex).toBe(0);
    expect(getAccountMetadata()?.selectedPath).toBe("m/44'/60'/0'/0/0");
  });

  it("manages tokens per selected account and persists hidden entries", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const readMetadata = vi.fn(async (address: `0x${string}`, chainId: number) => ({
      chainId,
      address,
      name: "Test Token",
      symbol: "TST",
      decimals: 18,
    }));
    const service = new WalletService({
      storage,
      readTokenMetadata: readMetadata,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addAccount();

    const token = await service.addToken(
      "0x0000000000000000000000000000000000000001",
      SEPOLIA,
    );
    expect(token).toMatchObject({ symbol: "TST", hidden: false });
    await expect(
      service.addToken("0x0000000000000000000000000000000000000001", SEPOLIA),
    ).rejects.toThrow("already in the selected account");

    await service.selectAccount(0);
    expect(service.getState().accounts[0]?.tokens).toEqual([]);
    await expect(
      service.addToken("0x0000000000000000000000000000000000000001", SEPOLIA),
    ).resolves.toMatchObject({ symbol: "TST" });
    await service.hideToken(token.address, SEPOLIA);
    expect(service.getState().accounts[0]?.tokens[0]?.hidden).toBe(true);
    await service.restoreToken(token.address, SEPOLIA);
    expect(service.getState().accounts[0]?.tokens[0]?.hidden).toBe(false);

    expect(getAccountMetadata()?.accounts.map((account) => account.tokens)).toEqual([
      [
        {
          chainId: SEPOLIA,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          hidden: false,
        },
      ],
      [
        {
          chainId: SEPOLIA,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          hidden: false,
        },
      ],
    ]);
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid token addresses and retains metadata when contract reads fail", async () => {
    const service = new WalletService({
      storage: createStorage().storage,
      readTokenMetadata: vi.fn(async () => {
        throw new Error("Could not read ERC-20 metadata");
      }),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(service.addToken("invalid", SEPOLIA)).rejects.toThrow(
      "valid ERC-20 contract address",
    );
    await expect(
      service.addToken("0x0000000000000000000000000000000000000001", SEPOLIA),
    ).rejects.toThrow("Could not read ERC-20 metadata");
    expect(service.getState().accounts[0]?.tokens).toEqual([]);
  });

  it("manages NFT metadata per selected account and permanently removes local entries", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const readMetadata = vi.fn(
      async (
        address: `0x${string}`,
        tokenId: bigint,
        standard: "ERC-721" | "ERC-1155",
        chainId: number,
      ) => ({
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
        name: "Test NFT",
        description: "Locally listed metadata",
        imageUrl: "https://example.com/nft.png",
      }),
    );
    const service = new WalletService({
      storage,
      readNftMetadata: readMetadata,
      readNftOwnership: vi.fn(async () => true),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addAccount();

    const nft = await service.addNft(
      "0x0000000000000000000000000000000000000001",
      "00042",
      "ERC-721",
      SEPOLIA,
    );
    expect(nft).toMatchObject({
      tokenId: "42",
      standard: "ERC-721",
      name: "Test NFT",
    });
    await expect(
      service.addNft(
        "0x0000000000000000000000000000000000000001",
        "42",
        "ERC-721",
        SEPOLIA,
      ),
    ).rejects.toThrow("already listed");

    await service.selectAccount(0);
    expect(service.getState().accounts[0]?.nfts).toEqual([]);
    await expect(
      service.addNft(
        "0x0000000000000000000000000000000000000001",
        "42",
        "ERC-721",
        SEPOLIA,
      ),
    ).resolves.toMatchObject({ name: "Test NFT" });
    await service.removeNft(
      "0x0000000000000000000000000000000000000001",
      "42",
      "ERC-721",
      SEPOLIA,
    );
    expect(service.getState().accounts[0]?.nfts).toEqual([]);

    expect(getAccountMetadata()?.accounts.map((account) => account.nfts)).toEqual([
      [],
      [
        {
          chainId: SEPOLIA,
          address: "0x0000000000000000000000000000000000000001",
          tokenId: "42",
          standard: "ERC-721",
          name: "Test NFT",
          description: "Locally listed metadata",
          imageUrl: "https://example.com/nft.png",
        },
      ],
    ]);
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });

  it("does not persist an NFT when the contract or metadata fetch fails", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async () => {
        throw new Error("NFT metadata could not be loaded");
      }),
      readNftOwnership: vi.fn(async () => true),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(service.addNft("invalid", "1", "ERC-721", SEPOLIA)).rejects.toThrow(
      "valid NFT contract address",
    );
    await expect(
      service.addNft(
        "0x0000000000000000000000000000000000000001",
        "1",
        "ERC-721",
        SEPOLIA,
      ),
    ).rejects.toThrow("NFT metadata could not be loaded");
    expect(service.getState().accounts[0]?.nfts).toEqual([]);
    expect(getAccountMetadata()?.accounts[0]?.nfts).toBeUndefined();
  });

  it("refuses to list an NFT the selected account does not own", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const readMetadata = vi.fn(async () => {
      throw new Error("should not read metadata for an unowned token");
    });
    const readOwnership = vi.fn(async () => false);
    const service = new WalletService({
      storage,
      readNftMetadata: readMetadata,
      readNftOwnership: readOwnership,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(
      service.addNft(
        "0x0000000000000000000000000000000000000001",
        "42",
        "ERC-721",
        SEPOLIA,
      ),
    ).rejects.toThrow("does not own");
    expect(readOwnership).toHaveBeenCalledWith(
      "0x0000000000000000000000000000000000000001",
      BigInt("42"),
      "ERC-721",
      EXPECTED_ADDRESS,
      SEPOLIA,
    );
    expect(readMetadata).not.toHaveBeenCalled();
    expect(service.getState().accounts[0]?.nfts).toEqual([]);
    expect(getAccountMetadata()?.accounts[0]?.nfts).toBeUndefined();
  });

  it("fails closed when NFT ownership cannot be read", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const upstreamError = new Error("execution reverted: evil.example");
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async () => {
        throw new Error("should not read metadata when ownership is unknown");
      }),
      readNftOwnership: vi.fn(async () => {
        throw upstreamError;
      }),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    const thrown = await service
      .addNft(
        "0x0000000000000000000000000000000000000001",
        "42",
        "ERC-1155",
        SEPOLIA,
      )
      .catch((caught: unknown) => caught);

    expect((thrown as Error).message).toBe(
      "Could not verify NFT ownership. Confirm the contract, token ID, and standard, then retry.",
    );
    expect((thrown as Error).message).not.toContain("execution reverted");
    expect((thrown as Error).cause).toBe(upstreamError);
    expect(service.getState().accounts[0]?.nfts).toEqual([]);
    expect(getAccountMetadata()?.accounts[0]?.nfts).toBeUndefined();
  });

  it("drops listed NFTs this account no longer owns and persists the result", async () => {
    const { storage, getAccountMetadata } = createStorage();
    let transferredContract: string | null = null;
    const readOwnership = vi.fn(
      async (address: string) => address.toLowerCase() !== transferredContract,
    );
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async (address, tokenId, standard, chainId) => ({
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
        name: "Test NFT",
        description: "Locally listed metadata",
        imageUrl: "https://example.com/nft.png",
      })),
      readNftOwnership: readOwnership,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addNft(
      "0x0000000000000000000000000000000000000001",
      "1",
      "ERC-721",
      SEPOLIA,
    );
    await service.addNft(
      "0x0000000000000000000000000000000000000002",
      "7",
      "ERC-1155",
      SEPOLIA,
    );

    // The ERC-1155 token was transferred away in the meantime.
    transferredContract = "0x0000000000000000000000000000000000000002";
    await service.syncNftOwnership();

    expect(service.getState().accounts[0]?.nfts).toMatchObject([
      {
        address: "0x0000000000000000000000000000000000000001",
        tokenId: "1",
        standard: "ERC-721",
      },
    ]);
    expect(getAccountMetadata()?.accounts[0]?.nfts).toMatchObject([
      {
        address: "0x0000000000000000000000000000000000000001",
        tokenId: "1",
        standard: "ERC-721",
      },
    ]);
    expect(readOwnership).toHaveBeenLastCalledWith(
      "0x0000000000000000000000000000000000000002",
      BigInt("7"),
      "ERC-1155",
      EXPECTED_ADDRESS,
      SEPOLIA,
    );
  });

  it("keeps listed NFTs when ownership cannot be re-checked", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const readOwnership = vi.fn(async () => true);
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async (address, tokenId, standard, chainId) => ({
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
        name: "Test NFT",
        description: "Locally listed metadata",
        imageUrl: "https://example.com/nft.png",
      })),
      readNftOwnership: readOwnership,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addNft(
      "0x0000000000000000000000000000000000000001",
      "1",
      "ERC-721",
      SEPOLIA,
    );

    readOwnership.mockRejectedValue(new Error("rpc unavailable"));
    await service.syncNftOwnership();

    expect(service.getState().accounts[0]?.nfts).toHaveLength(1);
    expect(getAccountMetadata()?.accounts[0]?.nfts).toHaveLength(1);
  });

  it("does not re-check ownership while the wallet is locked", async () => {
    const { storage } = createStorage();
    const readOwnership = vi.fn(async () => false);
    const service = new WalletService({
      storage,
      readNftOwnership: readOwnership,
    });

    await service.syncNftOwnership();

    expect(readOwnership).not.toHaveBeenCalled();
    expect(service.getState().accounts).toEqual([]);
  });

  it("removes stale entries as soon as a wallet session starts", async () => {
    const { storage, getAccountMetadata } = createStorage();
    const readOwnership = vi.fn(async () => true);
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async (address, tokenId, standard, chainId) => ({
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
        name: "Test NFT",
        description: "Locally listed metadata",
        imageUrl: "https://example.com/nft.png",
      })),
      readNftOwnership: readOwnership,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addNft(
      "0x0000000000000000000000000000000000000002",
      "7",
      "ERC-721",
      SEPOLIA,
    );

    // The token was transferred away while the wallet was locked, so unlocking
    // again must drop the now stale entry.
    readOwnership.mockResolvedValue(false);
    service.lock();
    await service.unlock("correct horse");
    expect(service.getState().accounts[0]?.nfts).toHaveLength(1);

    await vi.waitFor(() => {
      expect(service.getState().accounts[0]?.nfts).toEqual([]);
    });
    expect(getAccountMetadata()?.accounts[0]?.nfts).toEqual([]);
  });

  it("keeps an NFT added while ownership re-checks are in flight", async () => {
    const { storage } = createStorage();
    let releaseStaleRead: (() => void) | undefined;
    const staleRead = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    const readOwnership = vi.fn(async () => true);
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async (address, tokenId, standard, chainId) => ({
        chainId,
        address,
        tokenId: tokenId.toString(),
        standard,
        name: "Test NFT",
        description: "Locally listed metadata",
        imageUrl: "https://example.com/nft.png",
      })),
      readNftOwnership: readOwnership,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.addNft(
      "0x0000000000000000000000000000000000000001",
      "1",
      "ERC-721",
      SEPOLIA,
    );

    // The re-check of the older entry hangs and then reports it as unowned.
    readOwnership.mockImplementationOnce(async () => {
      await staleRead;
      return false;
    });
    const sync = service.syncNftOwnership();

    await service.addNft(
      "0x0000000000000000000000000000000000000002",
      "7",
      "ERC-1155",
      SEPOLIA,
    );
    releaseStaleRead?.();
    await sync;

    expect(service.getState().accounts[0]?.nfts).toMatchObject([
      {
        address: "0x0000000000000000000000000000000000000002",
        tokenId: "7",
        standard: "ERC-1155",
      },
    ]);
  });

  it("rejects account operations while locked or for an unknown index", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(service.addAccount()).rejects.toThrow("Wallet is locked");
    await expect(service.selectAccount(0)).rejects.toThrow("Wallet is locked");

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(service.selectAccount(1)).rejects.toThrow(
      "Account does not exist",
    );
  });

  it("cancels wallet preparation when locked while loading the registry", async () => {
    const { storage } = createStorage();
    const service = new WalletService({ storage });
    const preparation = service.prepareWallet();

    service.lock();

    await expect(preparation).rejects.toThrow("Wallet operation was cancelled");
  });

  it("cancels wallet import when locked while loading the registry", async () => {
    const { storage } = createStorage();
    const service = new WalletService({ storage });
    const importing = service.importWallet(TEST_MNEMONIC, "correct horse");

    service.lock();

    await expect(importing).rejects.toThrow("Wallet operation was cancelled");
    expect(storage.saveVault).not.toHaveBeenCalled();
  });

  it("does not unlock when vault persistence fails during import", async () => {
    const storage = createStorage().storage;
    vi.mocked(storage.saveVault).mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    const service = new WalletService({ storage });

    await expect(
      service.importWallet(TEST_MNEMONIC, "correct horse"),
    ).rejects.toThrow("Storage unavailable");
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("does not unlock when the encrypted vault cannot be saved after backup", async () => {
    const storage = createStorage().storage;
    vi.mocked(storage.saveVault).mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    const service = new WalletService({ storage });

    await service.prepareWallet();
    await expect(
      service.createWallet("correct horse", true),
    ).rejects.toThrow("Storage unavailable");
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });
});

describe("WalletService multi-wallet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers each created or imported wallet with a default name", async () => {
    const { storage, getRegistry } = createStorage();
    const service = new WalletService({ storage });

    await service.importWallet(TEST_MNEMONIC, "first password");
    await service.importWallet(TEST_MNEMONIC, "second password");

    expect(service.getState().wallets.map((wallet) => wallet.name)).toEqual([
      "Wallet 1",
      "Wallet 2",
    ]);
    expect(getRegistry()?.wallets).toHaveLength(2);
    // The most recently added wallet becomes the selected session.
    expect(service.getState().selectedWalletId).toBe(getRegistry()?.selectedId);
  });

  it("keeps per-wallet passwords and unlocks only the selected wallet", async () => {
    const { storage } = createStorage();
    const service = new WalletService({ storage });

    await service.importWallet(TEST_MNEMONIC, "first password");
    const firstId = service.getState().selectedWalletId;
    await service.importWallet(TEST_MNEMONIC, "second password");
    const secondId = service.getState().selectedWalletId;
    expect(firstId).not.toBeNull();
    expect(firstId).not.toBe(secondId);

    service.lock();
    await expect(service.unlock("first password")).rejects.toThrow(
      "Unable to decrypt vault",
    );

    await service.selectWallet(firstId!);
    await service.unlock("first password");
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);

    // Switching wallets while unlocked drops the session: each has its own
    // password, so the next one must be unlocked on its own.
    expect(service.isUnlocked).toBe(true);
    await service.selectWallet(secondId!);
    expect(service.isUnlocked).toBe(false);
  });

  it("renames a wallet and persists the name across a reload", async () => {
    const { storage } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    const walletId = service.getState().selectedWalletId!;

    await service.renameWallet(walletId, "  Savings  ");
    expect(service.getState().wallets[0]?.name).toBe("Savings");

    await expect(service.renameWallet(walletId, "   ")).rejects.toThrow(
      "between 1 and 32 characters",
    );

    const reloaded = new WalletService({ storage });
    await reloaded.refreshWallets();
    expect(reloaded.getState().wallets[0]?.name).toBe("Savings");
  });

  it("deletes a wallet only after verifying its password", async () => {
    const { storage, getRegistry } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    const walletId = service.getState().selectedWalletId!;

    await expect(
      service.deleteWallet(walletId, "wrong password"),
    ).rejects.toThrow("Unable to decrypt vault");
    expect(getRegistry()?.wallets).toHaveLength(1);

    await service.deleteWallet(walletId, "correct horse");
    expect(service.getState().wallets).toHaveLength(0);
    expect(service.getState().selectedWalletId).toBeNull();
    // The active session is dropped along with the wallet.
    expect(service.isUnlocked).toBe(false);
    await expect(storage.loadVault(walletId)).resolves.toBeNull();
  });

  it("keeps the unlocked session when another wallet is deleted", async () => {
    const { storage, getRegistry } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "first password");
    const firstId = service.getState().selectedWalletId!;
    await service.importWallet(TEST_MNEMONIC, "second password");

    await service.deleteWallet(firstId, "first password");

    expect(getRegistry()?.wallets).toHaveLength(1);
    expect(service.isUnlocked).toBe(true);
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
  });

  it("exposes the registry while locked for the manager screen", async () => {
    const { storage } = createStorage();
    const created = new WalletService({ storage });
    await created.importWallet(TEST_MNEMONIC, "correct horse");

    const fresh = new WalletService({ storage });
    expect(fresh.getState().wallets).toEqual([]);
    await fresh.refreshWallets();
    expect(fresh.getState().wallets).toHaveLength(1);
    expect(fresh.getState().selectedWalletId).not.toBeNull();
    expect(fresh.isUnlocked).toBe(false);
  });
});

/**
 * A deterministic, salt-dependent stand-in for the WebAuthn PRF extension. The
 * real extension derives its output from the credential and the salt, so a
 * mismatched salt yields a different output — the failure mode this guards
 * against. A constant mock would hide that bug.
 */
function derivePrf(prfSalt: Uint8Array): Uint8Array {
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (prfSalt[index % prfSalt.length] ?? 0) ^ (index + 1);
  }
  return output;
}

function createBiometricProvider(
  overrides: Partial<BiometricUnlockProvider> = {},
): BiometricUnlockProvider {
  return {
    isSupported: vi.fn(async () => true),
    register: vi.fn(async ({ prfSalt }) => ({
      credentialId: "credential-1",
      prfOutput: derivePrf(prfSalt),
    })),
    evaluate: vi.fn(async ({ prfSalt }) => derivePrf(prfSalt)),
    getRpId: vi.fn(() => "localhost"),
    ...overrides,
  };
}

describe("WalletService biometric unlock", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires an unlocked wallet to enable biometric unlock", async () => {
    const { storage, getBiometricVault } = createStorage();
    const service = new WalletService({
      storage,
      biometric: createBiometricProvider(),
    });

    await expect(
      service.enableBiometricUnlock("correct horse"),
    ).rejects.toThrow("Wallet is locked");
    expect(getBiometricVault()).toBeNull();
  });

  it("wraps the recovery phrase and unlocks with the passkey PRF", async () => {
    const { storage, getBiometricVault } = createStorage();
    const biometric = createBiometricProvider();
    const service = new WalletService({ storage, biometric });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await service.enableBiometricUnlock("correct horse");

    expect(getBiometricVault()).not.toBeNull();
    expect(JSON.stringify(getBiometricVault())).not.toContain(TEST_MNEMONIC);
    expect(biometric.register).toHaveBeenCalledWith({
      rpId: "localhost",
      userName: EXPECTED_ADDRESS,
      prfSalt: expect.any(Uint8Array),
    });

    service.lock();
    expect(service.getState()).toMatchObject(LOCKED_STATE);
    await service.unlockWithBiometric();
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
  });

  it("stores the same PRF salt it registered with the passkey", async () => {
    const { storage, getBiometricVault } = createStorage();
    const biometric = createBiometricProvider();
    const service = new WalletService({ storage, biometric });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await service.enableBiometricUnlock("correct horse");

    const registeredSalt =
      vi.mocked(biometric.register).mock.calls[0]?.[0].prfSalt;
    const storedVault = getBiometricVault();
    if (!storedVault) throw new Error("expected a stored biometric vault");

    // Unlock re-evaluates the PRF with the stored salt, so it must match the
    // salt the passkey was registered with.
    expect(registeredSalt).toBeInstanceOf(Uint8Array);
    expect(decodeBase64(storedVault.prfSalt, "prf salt")).toEqual(
      registeredSalt,
    );
  });

  it("refuses to enable with a wrong password and stores nothing", async () => {
    const { storage, getBiometricVault } = createStorage();
    const biometric = createBiometricProvider();
    const service = new WalletService({ storage, biometric });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(
      service.enableBiometricUnlock("wrong password"),
    ).rejects.toThrow("Unable to decrypt vault");
    expect(getBiometricVault()).toBeNull();
    expect(biometric.register).not.toHaveBeenCalled();
  });

  it("fails when no wallet is selected or biometric unlock is not set up", async () => {
    const empty = new WalletService({
      storage: createStorage().storage,
      biometric: createBiometricProvider(),
    });
    await expect(empty.unlockWithBiometric()).rejects.toThrow(
      "No wallet is stored",
    );

    const seeded = new WalletService({
      storage: createStorage(
        await encryptVault(TEST_MNEMONIC, "correct horse"),
      ).storage,
      biometric: createBiometricProvider(),
    });
    await expect(seeded.unlockWithBiometric()).rejects.toThrow("not set up");
  });

  it("rejects a wrapped vault from another origin", async () => {
    const storedVault: BiometricVault = {
      version: 1,
      credentialId: "credential-1",
      rpId: "example.com",
      prfSalt: "c2FsdA==",
      kdfSalt: "a2Rmc2FsdA==",
      iv: "aXY=",
      ciphertext: "Y2lwaGVydGV4dA==",
      createdAt: 1,
    };
    const { storage } = createStorage(null, null, storedVault);
    const biometric = createBiometricProvider();
    const service = new WalletService({ storage, biometric });

    await expect(service.unlockWithBiometric()).rejects.toThrow(
      "must be set up again",
    );
    expect(biometric.evaluate).not.toHaveBeenCalled();
  });

  it("fails to decrypt when the passkey returns a different PRF output", async () => {
    const { storage } = createStorage();
    const biometric = createBiometricProvider();
    const service = new WalletService({ storage, biometric });
    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await service.enableBiometricUnlock("correct horse");

    biometric.evaluate = vi.fn(async () => new Uint8Array(32).fill(200));
    service.lock();

    await expect(service.unlockWithBiometric()).rejects.toThrow(
      "Unable to decrypt the biometric vault",
    );
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("reports and clears the local enrollment", async () => {
    const { storage, getBiometricVault } = createStorage();
    const service = new WalletService({
      storage,
      biometric: createBiometricProvider(),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(service.hasBiometricUnlock()).resolves.toBe(false);
    await expect(service.isBiometricUnlockAvailable()).resolves.toBe(true);

    await service.enableBiometricUnlock("correct horse");
    await expect(service.hasBiometricUnlock()).resolves.toBe(true);

    await service.disableBiometricUnlock();
    await expect(service.hasBiometricUnlock()).resolves.toBe(false);
    expect(getBiometricVault()).toBeNull();
  });

  it("reads the selected account's delegation only while unlocked", async () => {
    const delegate = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e" as const;
    const readDelegatedAddress = vi.fn(async () => delegate);
    const service = new WalletService({
      storage: createStorage().storage,
      readDelegatedAddress,
    });

    await expect(service.getDelegatedAddress(SEPOLIA)).rejects.toThrow(
      "Wallet is locked",
    );
    expect(readDelegatedAddress).not.toHaveBeenCalled();

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(service.getDelegatedAddress(SEPOLIA)).resolves.toBe(delegate);
    expect(readDelegatedAddress).toHaveBeenCalledWith(EXPECTED_ADDRESS, SEPOLIA);

    service.lock();
    await expect(service.getDelegatedAddress(SEPOLIA)).rejects.toThrow(
      "Wallet is locked",
    );
  });

  it("revokes the selected account's delegation with its in-memory key", async () => {
    const hash = `0x${"a".repeat(64)}` as const;
    const revokeDelegation = vi.fn(async () => hash);
    const service = new WalletService({
      storage: createStorage().storage,
      revokeDelegation,
    });

    await expect(service.revokeAccountDelegation(SEPOLIA)).rejects.toThrow(
      "Wallet is locked",
    );
    expect(revokeDelegation).not.toHaveBeenCalled();

    await service.importWallet(TEST_MNEMONIC, "correct horse");
    await expect(service.revokeAccountDelegation(SEPOLIA)).resolves.toBe(hash);
    expect(revokeDelegation).toHaveBeenCalledWith({
      address: EXPECTED_ADDRESS,
      chainId: SEPOLIA,
      privateKey: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });
});

// The private key of a distinct account (Hardhat account 1), used by the
// import tests below.
const IMPORTED_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("WalletService private key import", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("imports a private key as a single imported account", async () => {
    const { storage, getVault, getAccountMetadata } = createStorage();
    const service = new WalletService({ storage });

    await expect(
      service.importPrivateKey(IMPORTED_PRIVATE_KEY, "correct horse"),
    ).resolves.toBe(SECOND_ADDRESS);
    expect(service.getState()).toMatchObject({
      isUnlocked: true,
      address: SECOND_ADDRESS,
      selectedAccountIndex: 0,
      accounts: [
        {
          index: 0,
          path: "imported",
          name: "Account 1",
          address: SECOND_ADDRESS,
          hidden: false,
          tokens: [],
          nfts: [],
        },
      ],
    });
    expect(service.getState().wallets[0]).toMatchObject({
      name: "Imported key 1",
      kind: "privateKey",
    });
    expect(getAccountMetadata()?.accounts[0]?.path).toBe("imported");
    // The key is only ever persisted encrypted.
    expect(JSON.stringify(getVault())).not.toContain(IMPORTED_PRIVATE_KEY);
  });

  it("unlocks and reveals an imported key after verifying the password", async () => {
    const service = new WalletService({ storage: createStorage().storage });
    await service.importPrivateKey(IMPORTED_PRIVATE_KEY, "correct horse");
    service.lock();
    expect(service.getState()).toMatchObject(LOCKED_STATE);

    await service.unlock("correct horse");
    expect(service.getAddress()).toBe(SECOND_ADDRESS);
    expect(service.getState().accounts[0]?.path).toBe("imported");

    await expect(
      service.revealPrivateKey(0, "wrong password"),
    ).rejects.toThrow("Unable to decrypt vault");
    await expect(service.revealPrivateKey(0, "correct horse")).resolves.toBe(
      IMPORTED_PRIVATE_KEY,
    );
  });

  it("signs and sends with the imported key", async () => {
    const sendTransfer = vi.fn(async () => "0x1234" as `0x${string}`);
    const service = new WalletService({
      storage: createStorage().storage,
      sendTransfer,
    });
    await service.importPrivateKey(IMPORTED_PRIVATE_KEY, "correct horse");

    await service.signAndSendTransaction({
      from: SECOND_ADDRESS as `0x${string}`,
      to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      value: BigInt(1),
      chainId: SEPOLIA,
    });

    expect(sendTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: IMPORTED_PRIVATE_KEY }),
    );
  });

  it("refuses to add a derived account to an imported-key wallet", async () => {
    const service = new WalletService({ storage: createStorage().storage });
    await service.importPrivateKey(IMPORTED_PRIVATE_KEY, "correct horse");

    await expect(service.addAccount()).rejects.toThrow(
      "Imported-key wallets cannot add accounts",
    );
  });

  it("accepts a key without the 0x prefix", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(
      service.importPrivateKey(IMPORTED_PRIVATE_KEY.slice(2), "correct horse"),
    ).resolves.toBe(SECOND_ADDRESS);
  });

  it("rejects an invalid key without creating a wallet", async () => {
    const { storage, getRegistry } = createStorage();
    const service = new WalletService({ storage });

    await expect(
      service.importPrivateKey("0x1234", "correct horse"),
    ).rejects.toThrow("64 hexadecimal characters");
    expect(getRegistry()?.wallets ?? []).toHaveLength(0);
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("records the kind for mnemonic wallets", async () => {
    const { storage, getRegistry } = createStorage();
    const service = new WalletService({ storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    expect(getRegistry()?.wallets[0]).toMatchObject({ kind: "mnemonic" });
  });

  it("supports biometric unlock for an imported-key wallet", async () => {
    const service = new WalletService({
      storage: createStorage().storage,
      biometric: createBiometricProvider(),
    });
    await service.importPrivateKey(IMPORTED_PRIVATE_KEY, "correct horse");
    await service.enableBiometricUnlock("correct horse");

    service.lock();
    await service.unlockWithBiometric();

    expect(service.getAddress()).toBe(SECOND_ADDRESS);
    expect(service.getState().accounts[0]?.path).toBe("imported");
  });
});

describe("wallet service session locking", () => {
  it("records an inactivity lock and clears it on a manual lock", () => {
    const service = new WalletService({ storage: createStorage().storage });

    service.lock("inactivity");
    expect(service.getLockReason()).toBe("inactivity");

    service.lock();
    expect(service.getLockReason()).toBeNull();
  });

  it("refuses to unlock while the throttle is active", async () => {
    const throttle = {
      retryAfterMs: vi.fn(() => 30_000),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };
    const service = new WalletService({
      storage: createStorage().storage,
      unlockThrottle: throttle,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse battery");

    await expect(
      service.unlock("correct horse battery"),
    ).rejects.toBeInstanceOf(UnlockThrottledError);
    await expect(service.unlock("correct horse battery")).rejects.toThrow(
      "Too many attempts. Try again in 30s.",
    );

    expect(throttle.recordFailure).not.toHaveBeenCalled();
    expect(throttle.recordSuccess).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("counts a wrong password and clears the counter on success", async () => {
    const throttle = {
      retryAfterMs: vi.fn(() => 0),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };
    const service = new WalletService({
      storage: createStorage().storage,
      unlockThrottle: throttle,
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse battery");

    await expect(service.unlock("wrong password")).rejects.toBeInstanceOf(
      VaultDecryptionError,
    );
    expect(throttle.recordFailure).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject(LOCKED_STATE);

    await service.unlock("correct horse battery");
    expect(throttle.recordSuccess).toHaveBeenCalledTimes(1);
    expect(service.getAddress()).toBe(EXPECTED_ADDRESS);
  });

  it("reports the cooldown on the third wrong password", async () => {
    const service = new WalletService({ storage: createStorage().storage });
    await service.importWallet(TEST_MNEMONIC, "correct horse battery");
    expect(service.getUnlockCooldownRemainingMs()).toBe(0);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.unlock("wrong password")).rejects.toBeInstanceOf(
        VaultDecryptionError,
      );
      expect(service.getUnlockCooldownRemainingMs()).toBe(0);
    }

    // The attempt that starts the cooldown says so immediately.
    await expect(service.unlock("wrong password")).rejects.toThrow(
      "Too many attempts. Try again in 30s.",
    );
    expect(service.getUnlockCooldownRemainingMs()).toBeGreaterThan(0);

    // Later attempts are refused by the pre-check, even with the right password.
    await expect(
      service.unlock("correct horse battery"),
    ).rejects.toBeInstanceOf(UnlockThrottledError);
    expect(service.getState()).toMatchObject(LOCKED_STATE);
  });

  it("reads the cooldown for the selected wallet only", async () => {
    const throttle = {
      retryAfterMs: vi.fn((walletId: string) =>
        walletId === DEFAULT_WALLET_ID ? 5_000 : 0,
      ),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };
    const service = new WalletService({
      storage: createStorage(null, null, null, seedRegistry()).storage,
      unlockThrottle: throttle,
    });

    // No registry loaded yet: nothing to report.
    expect(service.getUnlockCooldownRemainingMs()).toBe(0);

    await service.refreshWallets();
    expect(service.getUnlockCooldownRemainingMs()).toBe(5_000);
    expect(throttle.retryAfterMs).toHaveBeenCalledWith(DEFAULT_WALLET_ID);
  });
});
