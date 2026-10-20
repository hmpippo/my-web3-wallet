import { bytesToHex, hexToBytes, type Hex } from "viem";

/**
 * Secrets in this wallet should live as mutable bytes for as long as the
 * session needs them: JavaScript strings cannot be zeroed, so hex strings are
 * converted at the boundary (viem needs hex) and never kept as the long-lived
 * copy. `wipe` overwrites the buffer before it is dropped.
 */
export function secretToBytes(secret: Hex): Uint8Array {
  return hexToBytes(secret);
}

export function bytesToSecret(bytes: Uint8Array): Hex {
  return bytesToHex(bytes);
}

export function wipeBytes(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}

/** Zeroes every key buffer, then clears the map. */
export function wipeSecretMap(keys: Map<number, Uint8Array>): void {
  for (const key of keys.values()) key.fill(0);
  keys.clear();
}
