import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBase64 } from "@/lib/base64";
import {
  BiometricVaultError,
  createPrfSalt,
  unwrapMnemonic,
  validateBiometricVault,
  wrapMnemonic,
  type BiometricVault,
} from "./biometric-vault";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const PRF_OUTPUT = new Uint8Array(32).fill(7);
const PRF_SALT = new Uint8Array(32).fill(1);

describe("biometric vault wrapping", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", globalThis.crypto);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("wraps and unwraps the recovery phrase under the PRF output", async () => {
    const vault = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });

    expect(vault.version).toBe(1);
    expect(vault.credentialId).toBe("credential-1");
    expect(vault.rpId).toBe("localhost");
    expect(vault.prfSalt).not.toBe("");
    expect(vault.kdfSalt).not.toBe("");
    expect(vault.iv).not.toBe("");
    expect(vault.ciphertext).not.toContain(TEST_MNEMONIC);
    expect(vault.createdAt).toBeGreaterThan(0);
    await expect(unwrapMnemonic(vault, PRF_OUTPUT)).resolves.toBe(
      TEST_MNEMONIC,
    );
  });

  it("stores the caller's salt and a unique KDF salt and IV per wrapping", async () => {
    const first = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });
    const second = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });

    // The PRF salt is the caller's responsibility and is stored verbatim.
    expect(decodeBase64(first.prfSalt, "prf salt")).toEqual(PRF_SALT);
    expect(decodeBase64(second.prfSalt, "prf salt")).toEqual(PRF_SALT);
    // The at-rest salts and IV are always fresh.
    expect(first.kdfSalt).not.toBe(second.kdfSalt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails to unwrap with a different PRF output", async () => {
    const vault = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });

    await expect(
      unwrapMnemonic(vault, new Uint8Array(32).fill(200)),
    ).rejects.toBeInstanceOf(BiometricVaultError);
  });

  it("fails to unwrap a tampered vault", async () => {
    const vault = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });

    await expect(
      unwrapMnemonic({ ...vault, iv: "AAAAAAAAAAAAAAAA" }, PRF_OUTPUT),
    ).rejects.toBeInstanceOf(BiometricVaultError);
  });

  it("rejects empty phrases, missing ids, and short PRF output", async () => {
    await expect(
      wrapMnemonic({
        mnemonic: "",
        prfOutput: PRF_OUTPUT,
        credentialId: "credential-1",
        rpId: "localhost",
        prfSalt: PRF_SALT,
      }),
    ).rejects.toThrow("must not be empty");

    await expect(
      wrapMnemonic({
        mnemonic: TEST_MNEMONIC,
        prfOutput: PRF_OUTPUT,
        credentialId: "",
        rpId: "localhost",
        prfSalt: PRF_SALT,
      }),
    ).rejects.toThrow("Credential id must not be empty");

    await expect(
      wrapMnemonic({
        mnemonic: TEST_MNEMONIC,
        prfOutput: new Uint8Array(4),
        credentialId: "credential-1",
        rpId: "localhost",
        prfSalt: PRF_SALT,
      }),
    ).rejects.toThrow("too short");
  });

  it("stores the exact PRF salt supplied by the caller", async () => {
    const vault = await wrapMnemonic({
      mnemonic: TEST_MNEMONIC,
      prfOutput: PRF_OUTPUT,
      credentialId: "credential-1",
      rpId: "localhost",
      prfSalt: PRF_SALT,
    });

    // Unlock re-evaluates the PRF with this stored salt, so it must be the same
    // salt that produced `prfOutput`.
    expect(decodeBase64(vault.prfSalt, "prf salt")).toEqual(PRF_SALT);
  });

  it("rejects a PRF salt of the wrong length", async () => {
    await expect(
      wrapMnemonic({
        mnemonic: TEST_MNEMONIC,
        prfOutput: PRF_OUTPUT,
        credentialId: "credential-1",
        rpId: "localhost",
        prfSalt: new Uint8Array(8),
      }),
    ).rejects.toThrow("PRF salt must be 32 bytes");
  });

  it("generates a 32-byte PRF salt", () => {
    const first = createPrfSalt();
    const second = createPrfSalt();

    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
  });

  it("rejects malformed vault records", () => {
    expect(() => validateBiometricVault({ version: 1 })).toThrow(
      "invalid structure",
    );
    expect(() =>
      validateBiometricVault({
        version: 1,
        credentialId: "",
        rpId: "localhost",
        prfSalt: "c2FsdA==",
        kdfSalt: "a2Rmc2FsdA==",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      }),
    ).toThrow("invalid structure");
    expect(() =>
      validateBiometricVault({ version: 2 } as unknown as BiometricVault),
    ).toThrow("invalid structure");
  });
});
