import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptVault, type EncryptedVault } from "@/core/crypto";
import { deriveAccountAtIndex, mnemonicToSeed } from "@/core/hd-wallet";
import type {
  StorageService,
  WalletAccountMetadata,
} from "@/core/storage";
import { WalletService } from "./wallet-service";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SECOND_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LOCKED_STATE = {
  isUnlocked: false,
  address: null,
  accounts: [],
  selectedAccountIndex: null,
};
const SEPOLIA = 11155111;

function createStorage(
  initialVault: EncryptedVault | null = null,
  initialMetadata: WalletAccountMetadata | null = null,
) {
  let vault = initialVault;
  let accountMetadata = initialMetadata;
  const storage: StorageService = {
    saveVault: vi.fn(async (value) => {
      vault = value;
    }),
    loadVault: vi.fn(async () => vault),
    clearVault: vi.fn(async () => {
      vault = null;
    }),
    hasVault: vi.fn(async () => vault !== null),
    saveAccountMetadata: vi.fn(async (value) => {
      accountMetadata = value;
    }),
    loadAccountMetadata: vi.fn(async () => accountMetadata),
    clearAccountMetadata: vi.fn(async () => {
      accountMetadata = null;
    }),
  };
  return {
    storage,
    getVault: () => vault,
    getAccountMetadata: () => accountMetadata,
  };
}

describe("WalletService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit backup confirmation before persisting a new wallet", async () => {
    const { storage, getVault } = createStorage();
    const service = new WalletService({ storage });
    const prepared = await service.prepareWallet();

    expect(prepared.mnemonic.split(" ")).toHaveLength(12);
    expect(service.getState()).toEqual(LOCKED_STATE);
    expect(getVault()).toBeNull();

    await expect(service.createWallet("correct horse", false)).rejects.toThrow(
      "Confirm that you have backed up",
    );
    expect(storage.saveVault).not.toHaveBeenCalled();

    const created = await service.createWallet("correct horse", true);
    expect(created).toEqual(prepared);
    expect(service.getState()).toEqual({
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
    expect(service.getState()).toEqual(LOCKED_STATE);
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
    expect(service.getState()).toEqual(LOCKED_STATE);
    await service.unlock("correct horse");
    expect(service.getState()).toEqual({
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

  it("rejects invalid phrases and does not overwrite an existing vault", async () => {
    const { storage } = createStorage({
      version: 1,
      salt: "c2FsdA==",
      iv: "aXY=",
      ciphertext: "Y2lwaGVydGV4dA==",
    });
    const service = new WalletService({ storage });

    await expect(
      service.importWallet("not a valid phrase", "correct horse"),
    ).rejects.toThrow("Invalid BIP-39 mnemonic");
    await expect(service.prepareWallet()).rejects.toThrow(
      "A wallet already exists",
    );
    expect(storage.saveVault).not.toHaveBeenCalled();
  });

  it("fails to unlock for a wrong password and stays locked", async () => {
    const vault = await encryptVault(TEST_MNEMONIC, "correct horse");
    const service = new WalletService({ storage: createStorage(vault).storage });

    await expect(service.unlock("wrong password")).rejects.toThrow(
      "Unable to decrypt vault",
    );
    expect(service.getState()).toEqual(LOCKED_STATE);
  });

  it("fails when no vault exists", async () => {
    const service = new WalletService({ storage: createStorage().storage });

    await expect(service.unlock("correct horse")).rejects.toThrow(
      "No wallet is stored",
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
    let resolveLoad: ((vault: EncryptedVault | null) => void) | undefined;
    const storage: StorageService = {
      saveVault: vi.fn(async () => undefined),
      loadVault: vi.fn(
        () =>
          new Promise<EncryptedVault | null>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
      clearVault: vi.fn(async () => undefined),
      hasVault: vi.fn(async () => true),
      saveAccountMetadata: vi.fn(async () => undefined),
      loadAccountMetadata: vi.fn(async () => null),
      clearAccountMetadata: vi.fn(async () => undefined),
    };
    const service = new WalletService({ storage });
    const unlockPromise = service.unlock("correct horse");

    service.lock();
    resolveLoad?.(null);

    await expect(unlockPromise).rejects.toThrow("Wallet operation was cancelled");
    expect(service.getState()).toEqual(LOCKED_STATE);
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
    expect(service.getState()).toEqual({
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
    expect(service.getState()).toEqual(LOCKED_STATE);
    await service.unlock("correct horse");
    expect(service.getState()).toEqual({
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
    const service = new WalletService({
      storage,
      readNftMetadata: vi.fn(async () => {
        throw new Error("should not read metadata when ownership is unknown");
      }),
      readNftOwnership: vi.fn(async () => {
        throw new Error("execution reverted");
      }),
    });
    await service.importWallet(TEST_MNEMONIC, "correct horse");

    await expect(
      service.addNft(
        "0x0000000000000000000000000000000000000001",
        "42",
        "ERC-1155",
        SEPOLIA,
      ),
    ).rejects.toThrow(/Could not verify NFT ownership.*execution reverted/);
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

  it("cancels wallet preparation when locked while checking storage", async () => {
    let resolveHasVault: ((hasVault: boolean) => void) | undefined;
    const storage: StorageService = {
      saveVault: vi.fn(async () => undefined),
      loadVault: vi.fn(async () => null),
      clearVault: vi.fn(async () => undefined),
      hasVault: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveHasVault = resolve;
          }),
      ),
      saveAccountMetadata: vi.fn(async () => undefined),
      loadAccountMetadata: vi.fn(async () => null),
      clearAccountMetadata: vi.fn(async () => undefined),
    };
    const service = new WalletService({ storage });
    const preparation = service.prepareWallet();

    service.lock();
    resolveHasVault?.(false);

    await expect(preparation).rejects.toThrow("Wallet operation was cancelled");
  });

  it("cancels wallet import when locked while checking storage", async () => {
    let resolveHasVault: ((hasVault: boolean) => void) | undefined;
    const storage: StorageService = {
      saveVault: vi.fn(async () => undefined),
      loadVault: vi.fn(async () => null),
      clearVault: vi.fn(async () => undefined),
      hasVault: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveHasVault = resolve;
          }),
      ),
      saveAccountMetadata: vi.fn(async () => undefined),
      loadAccountMetadata: vi.fn(async () => null),
      clearAccountMetadata: vi.fn(async () => undefined),
    };
    const service = new WalletService({ storage });
    const importing = service.importWallet(TEST_MNEMONIC, "correct horse");

    service.lock();
    resolveHasVault?.(false);

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
    expect(service.getState()).toEqual(LOCKED_STATE);
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
    expect(service.getState()).toEqual(LOCKED_STATE);
  });
});
