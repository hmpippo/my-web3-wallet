import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Normalizes a user-supplied private key into a canonical `0x`-prefixed, 64
 * hex-character value. Accepts an optional `0x`/`0X` prefix and surrounding
 * whitespace, the shapes people paste from other wallets and explorers.
 *
 * A raw key has no checksum (unlike an address), so the only validation
 * possible here is structural; {@link addressFromPrivateKey} performs the final
 * secp256k1 check.
 */
export function normalizePrivateKey(input: string): Hex {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Enter the private key you want to import");
  }
  const prefixed = /^0x/i.test(trimmed)
    ? `0x${trimmed.slice(2)}`
    : `0x${trimmed}`;
  if (!PRIVATE_KEY_PATTERN.test(prefixed)) {
    throw new Error("A private key must be 64 hexadecimal characters");
  }
  return prefixed.toLowerCase() as Hex;
}

/**
 * Derives the EVM address for a private key. Throws when the key is not a valid
 * secp256k1 scalar (for example an all-zero or out-of-range value), so an
 * unusable key can never be persisted.
 */
export function addressFromPrivateKey(privateKey: Hex): Address {
  try {
    return privateKeyToAccount(privateKey).address;
  } catch {
    throw new Error("That private key is not a valid EVM key");
  }
}
