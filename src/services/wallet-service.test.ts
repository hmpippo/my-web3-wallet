import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptVault, type EncryptedVault } from "@/core/crypto";
import type { StorageService } from "@/core/storage";
import { WalletService } from "./wallet-service";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function createStorage(initialVault: EncryptedVault | null = null) {
  let vault = initialVault;
  const storage: StorageService = {
    saveVault: vi.fn(async (value) => {
      vault = value;
    }),
    loadVault: vi.fn(async () => vault),
    clearVault: vi.fn(async () => {
      vault = null;
    }),
    hasVault: vi.fn(async () => vault !== null),
  };
  return { storage, getVault: () => vault };
}

describe("WalletService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit backup confirmation before persisting a new wallet", async () => {
    const { storage, getVault } = createStorage();
    const service = new WalletService({ storage });
    const prepared = await service.prepareWallet();

    expect(prepared.mnemonic.split(" ")).toHaveLength(12);
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
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
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getState().isUnlocked).toBe(true);

    service.lock();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
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
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
    await service.unlock("correct horse");
    expect(service.getState()).toEqual({
      isUnlocked: true,
      address: EXPECTED_ADDRESS,
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
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
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
      to: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      value: BigInt(1),
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
      ...transaction,
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
    };
    const service = new WalletService({ storage });
    const unlockPromise = service.unlock("correct horse");

    service.lock();
    resolveLoad?.(null);

    await expect(unlockPromise).rejects.toThrow("Wallet operation was cancelled");
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
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
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
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
    expect(service.getState()).toEqual({ isUnlocked: false, address: null });
  });
});
