import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptVault,
  encryptVault,
  VaultDecryptionError,
} from "./crypto";

describe("vault encryption", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", globalThis.crypto);
  });

  it("encrypts and decrypts data with AES-GCM", async () => {
    const vault = await encryptVault("test recovery phrase", "correct horse");

    expect(vault.version).toBe(1);
    expect(vault.salt).not.toBe("");
    expect(vault.iv).not.toBe("");
    expect(vault.ciphertext).not.toContain("test recovery phrase");
    await expect(decryptVault(vault, "correct horse")).resolves.toBe(
      "test recovery phrase",
    );
  });

  it("uses a unique salt and IV for every encryption", async () => {
    const first = await encryptVault("same data", "correct horse");
    const second = await encryptVault("same data", "correct horse");

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails with a clear decryption error for the wrong password", async () => {
    const vault = await encryptVault("secret", "correct horse");

    await expect(decryptVault(vault, "wrong password")).rejects.toBeInstanceOf(
      VaultDecryptionError,
    );
  });

  it("rejects empty data and passwords shorter than eight characters", async () => {
    await expect(encryptVault("", "correct horse")).rejects.toThrow(
      "must not be empty",
    );
    await expect(encryptVault("secret", "short")).rejects.toThrow(
      "at least 8 characters",
    );
  });

  it("rejects malformed vaults before decrypting", async () => {
    await expect(
      decryptVault(
        {
          version: 1,
          salt: "not-base64",
          iv: "AQ==",
          ciphertext: "AQ==",
        },
        "correct horse",
      ),
    ).rejects.toThrow("salt is not valid base64");
  });
});
