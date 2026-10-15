import type { EncryptedVault } from "./crypto";

export const VAULT_STORAGE_KEY = "wallet_vault_v1";

export interface StorageService {
  saveVault(vault: EncryptedVault): Promise<void>;
  loadVault(): Promise<EncryptedVault | null>;
  clearVault(): Promise<void>;
  hasVault(): Promise<boolean>;
}

export const storageService: StorageService = {
  async saveVault(vault) {
    const storage = getLocalStorage();
    const validatedVault = parseStoredVault(vault);
    storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(validatedVault));
  },

  async loadVault() {
    const storage = getLocalStorage();
    const serializedVault = storage.getItem(VAULT_STORAGE_KEY);
    if (serializedVault === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedVault);
    } catch {
      throw new Error("Stored vault is not valid JSON");
    }
    return parseStoredVault(parsed);
  },

  async clearVault() {
    const storage = getLocalStorage();
    storage.removeItem(VAULT_STORAGE_KEY);
  },

  async hasVault() {
    return (await storageService.loadVault()) !== null;
  },
};

function getLocalStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Wallet storage is only available in a browser");
  }
  return window.localStorage;
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
