import { HDKey } from "@scure/bip32";
import {
  entropyToMnemonic as scureEntropyToMnemonic,
  generateMnemonic as scureGenerateMnemonic,
  mnemonicToEntropy as scureMnemonicToEntropy,
  mnemonicToSeed as scureMnemonicToSeed,
  validateMnemonic as scureValidateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { privateKeyToAccount } from "viem/accounts";
import { toHex, type Address, type Hex } from "viem";

export const DEFAULT_PATH = "m/44'/60'/0'/0/0";
export const MAX_ADDRESS_INDEX = 0x7fffffff;

export interface DerivedAccount {
  privateKey: Hex;
  address: Address;
  publicKey: Hex;
}

export interface HDWallet {
  generateMnemonic(strength?: 128 | 256): string;
  validateMnemonic(mnemonic: string): boolean;
  mnemonicToSeed(mnemonic: string, passphrase?: string): Promise<Uint8Array>;
  deriveAccount(seed: Uint8Array, path?: string): DerivedAccount;
  deriveAccountAtIndex(seed: Uint8Array, index: number): DerivedAccount;
}

export function generateMnemonic(strength: 128 | 256 = 128): string {
  if (strength !== 128 && strength !== 256) {
    throw new RangeError("Mnemonic strength must be 128 or 256 bits");
  }
  return scureGenerateMnemonic(wordlist, strength);
}

export function validateMnemonic(mnemonic: string): boolean {
  return scureValidateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

export async function mnemonicToSeed(
  mnemonic: string,
  passphrase = "",
): Promise<Uint8Array> {
  const normalizedMnemonic = normalizeMnemonic(mnemonic);
  if (!scureValidateMnemonic(normalizedMnemonic, wordlist)) {
    throw new Error("Invalid BIP-39 mnemonic");
  }
  return scureMnemonicToSeed(normalizedMnemonic, passphrase);
}

/**
 * BIP-39 entropy is the zeroizable form of a recovery phrase. The wallet keeps
 * it while a new wallet waits for backup confirmation, and re-encodes the words
 * only when the vault is written.
 */
export function mnemonicToEntropy(mnemonic: string): Uint8Array {
  const normalizedMnemonic = normalizeMnemonic(mnemonic);
  if (!scureValidateMnemonic(normalizedMnemonic, wordlist)) {
    throw new Error("Invalid BIP-39 mnemonic");
  }
  return scureMnemonicToEntropy(normalizedMnemonic, wordlist);
}

export function entropyToMnemonic(entropy: Uint8Array): string {
  return scureEntropyToMnemonic(entropy, wordlist);
}

export function deriveAccount(
  seed: Uint8Array,
  path = DEFAULT_PATH,
): DerivedAccount {
  if (seed.length < 16 || seed.length > 64) {
    throw new RangeError("BIP-32 seed must be between 16 and 64 bytes");
  }

  const masterKey = HDKey.fromMasterSeed(seed);
  let childKey: HDKey | undefined;

  try {
    childKey = masterKey.derive(path);
    const privateKeyBytes = childKey.privateKey;
    if (!privateKeyBytes || !childKey.publicKey) {
      throw new Error("Could not derive an account from the supplied seed");
    }

    const privateKey = toHex(privateKeyBytes);
    const account = privateKeyToAccount(privateKey);
    return {
      privateKey,
      address: account.address,
      publicKey: account.publicKey,
    };
  } finally {
    childKey?.wipePrivateData();
    masterKey.wipePrivateData();
  }
}

export function accountDerivationPath(index: number): string {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > MAX_ADDRESS_INDEX
  ) {
    throw new RangeError(
      `Account index must be an integer between 0 and ${MAX_ADDRESS_INDEX}`,
    );
  }
  return `m/44'/60'/0'/0/${index}`;
}

export function deriveAccountAtIndex(
  seed: Uint8Array,
  index: number,
): DerivedAccount {
  return deriveAccount(seed, accountDerivationPath(index));
}

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().split(/\s+/).join(" ");
}
