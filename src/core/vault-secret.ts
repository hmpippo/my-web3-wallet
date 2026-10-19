/**
 * The plaintext a wallet vault protects.
 *
 * A vault historically held a BIP-39 recovery phrase as a bare string. To also
 * support single private keys without breaking existing installs, new vaults
 * store a small JSON envelope while readers transparently treat any payload
 * that is not a recognized envelope as a legacy recovery phrase. The encrypted
 * envelope (`core/crypto.ts`) is unchanged, so no stored vault is migrated.
 */
export type VaultSecretKind = "mnemonic" | "privateKey";

export interface VaultSecret {
  readonly kind: VaultSecretKind;
  readonly secret: string;
}

/** Serializes a secret for encryption. Callers encrypt the returned string. */
export function encodeVaultSecret(secret: VaultSecret): string {
  return JSON.stringify({ version: 1, kind: secret.kind, secret: secret.secret });
}

/**
 * Parses a decrypted vault payload. An unrecognized payload (including a bare
 * recovery phrase written by an older version) is treated as a mnemonic, which
 * keeps pre-existing vaults working.
 */
export function parseVaultSecret(payload: string): VaultSecret {
  const parsed = tryParseJson(payload);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    const candidate = parsed as Record<string, unknown>;
    if (
      (candidate.kind === "mnemonic" || candidate.kind === "privateKey") &&
      typeof candidate.secret === "string" &&
      candidate.secret.length > 0
    ) {
      return { kind: candidate.kind, secret: candidate.secret };
    }
  }
  return { kind: "mnemonic", secret: payload.trim() };
}

function tryParseJson(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
