import { afterEach, describe, expect, it, vi } from "vitest";
import { storageService, VAULT_STORAGE_KEY } from "./storage";
import type { EncryptedVault } from "./crypto";

const testVault: EncryptedVault = {
  version: 1,
  salt: "c2FsdA==",
  iv: "aXY=",
  ciphertext: "Y2lwaGVydGV4dA==",
};

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
  };
}

describe("vault storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves and loads only the encrypted vault under the fixed key", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(testVault);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      VAULT_STORAGE_KEY,
      JSON.stringify(testVault),
    );
    await expect(storageService.loadVault()).resolves.toEqual(testVault);
    await expect(storageService.hasVault()).resolves.toBe(true);
  });

  it("returns null when no vault has been saved", async () => {
    vi.stubGlobal("window", { localStorage: createLocalStorageMock() });

    await expect(storageService.loadVault()).resolves.toBeNull();
    await expect(storageService.hasVault()).resolves.toBe(false);
  });

  it("clears the stored vault", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    await storageService.saveVault(testVault);
    await storageService.clearVault();

    expect(localStorage.removeItem).toHaveBeenCalledWith(VAULT_STORAGE_KEY);
    await expect(storageService.loadVault()).resolves.toBeNull();
  });

  it("surfaces invalid stored JSON and invalid vault shapes", async () => {
    const localStorage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(VAULT_STORAGE_KEY, "{");
    await expect(storageService.loadVault()).rejects.toThrow(
      "Stored vault is not valid JSON",
    );

    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ version: 1 }));
    await expect(storageService.loadVault()).rejects.toThrow(
      "invalid structure",
    );
  });

  it("fails explicitly outside a browser", async () => {
    vi.stubGlobal("window", undefined);

    await expect(storageService.loadVault()).rejects.toThrow(
      "only available in a browser",
    );
  });
});
