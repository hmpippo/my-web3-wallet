import { describe, expect, it } from "vitest";
import {
  accountDerivationPath,
  DEFAULT_PATH,
  deriveAccount,
  deriveAccountAtIndex,
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "./hd-wallet";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

describe("HD wallet", () => {
  it("generates valid 12-word and 24-word mnemonics", () => {
    const twelveWords = generateMnemonic();
    const twentyFourWords = generateMnemonic(256);

    expect(twelveWords.split(" ")).toHaveLength(12);
    expect(twentyFourWords.split(" ")).toHaveLength(24);
    expect(validateMnemonic(twelveWords)).toBe(true);
    expect(validateMnemonic(twentyFourWords)).toBe(true);
  });

  it("validates BIP-39 phrases and normalizes whitespace", () => {
    expect(validateMnemonic(TEST_MNEMONIC)).toBe(true);
    expect(validateMnemonic(`  ${TEST_MNEMONIC.replaceAll(" ", "  ")}  `)).toBe(
      true,
    );
    expect(validateMnemonic("invalid phrase")).toBe(false);
  });

  it("derives the known first Ethereum account from a mnemonic seed", async () => {
    const seed = await mnemonicToSeed(TEST_MNEMONIC);
    const account = deriveAccount(seed);

    expect(account.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(account.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(account.publicKey).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("derives the same account for the same seed and path", async () => {
    const seed = await mnemonicToSeed(TEST_MNEMONIC);

    expect(deriveAccount(seed, DEFAULT_PATH)).toEqual(
      deriveAccount(seed, DEFAULT_PATH),
    );
    expect(() => deriveAccount(new Uint8Array(15))).toThrow(
      "between 16 and 64 bytes",
    );
    expect(() => deriveAccount(seed, "invalid/path")).toThrow();
  });

  it("derives deterministic unique addresses for consecutive Ethereum account indices", async () => {
    const seed = await mnemonicToSeed(TEST_MNEMONIC);
    const account0 = deriveAccountAtIndex(seed, 0);
    const account1 = deriveAccountAtIndex(seed, 1);

    expect(accountDerivationPath(0)).toBe(DEFAULT_PATH);
    expect(account0.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(account1.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(account1).toEqual(deriveAccountAtIndex(seed, 1));
    expect(account1.address).not.toBe(account0.address);
  });

  it("rejects unsafe account indices", () => {
    expect(() => accountDerivationPath(-1)).toThrow("Account index");
    expect(() => accountDerivationPath(1.5)).toThrow("Account index");
    expect(() => accountDerivationPath(Number.MAX_SAFE_INTEGER)).toThrow(
      "Account index",
    );
  });

  it("rejects an invalid mnemonic when deriving a seed", async () => {
    await expect(mnemonicToSeed("invalid phrase")).rejects.toThrow(
      "Invalid BIP-39 mnemonic",
    );
  });
});
