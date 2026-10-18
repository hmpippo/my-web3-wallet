import { decodeBase64, encodeBase64 } from "@/lib/base64";

const VAULT_VERSION = 1 as const;
const IV_LENGTH = 12;
const AES_KEY_LENGTH = 256;
const AES_TAG_LENGTH = 128;
const PRF_SALT_LENGTH = 32;
const KDF_SALT_LENGTH = 16;
const MIN_PRF_OUTPUT_LENGTH = 16;
const HKDF_INFO = "my-wallet/biometric-vault/v1";

/**
 * A copy of the recovery phrase wrapped under a passkey-derived key.
 *
 * Only `ciphertext` is sensitive, and it can only be decrypted with the PRF
 * output of the passkey named by `credentialId`, so Touch ID / Face ID is
 * cryptographically required to unlock. `rpId` binds the record to the origin
 * that created it, so a vault copied to another host is rejected rather than
 * trusted.
 */
export interface BiometricVault {
  version: typeof VAULT_VERSION;
  credentialId: string;
  rpId: string;
  prfSalt: string;
  kdfSalt: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

export class BiometricVaultError extends Error {
  constructor(message = "Unable to decrypt the biometric vault.") {
    super(message);
    this.name = "BiometricVaultError";
  }
}

/** A fresh per-credential PRF salt. Safe to store beside the vault. */
export function createPrfSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(PRF_SALT_LENGTH));
}

export async function wrapMnemonic(params: {
  mnemonic: string;
  prfOutput: Uint8Array;
  credentialId: string;
  rpId: string;
  /**
   * The exact salt whose PRF output was evaluated for this credential. It must
   * be the salt passed to the WebAuthn ceremony, and it is stored so unlock can
   * re-evaluate the identical value. A different salt yields a different PRF
   * output, so the wrapped phrase would never decrypt.
   */
  prfSalt: Uint8Array;
}): Promise<BiometricVault> {
  const { mnemonic, prfOutput, credentialId, rpId, prfSalt } = params;
  if (mnemonic.length === 0) {
    throw new TypeError("Recovery phrase must not be empty");
  }
  validatePrfOutput(prfOutput);
  validatePrfSalt(prfSalt);
  if (credentialId.length === 0) {
    throw new TypeError("Credential id must not be empty");
  }
  if (rpId.length === 0) {
    throw new TypeError("Relying-party id must not be empty");
  }

  const kdfSalt = crypto.getRandomValues(new Uint8Array(KDF_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(prfOutput, kdfSalt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: AES_TAG_LENGTH },
    key,
    new TextEncoder().encode(mnemonic),
  );

  return {
    version: VAULT_VERSION,
    credentialId,
    rpId,
    prfSalt: encodeBase64(prfSalt),
    kdfSalt: encodeBase64(kdfSalt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(encrypted)),
    createdAt: Date.now(),
  };
}

export async function unwrapMnemonic(
  vault: BiometricVault,
  prfOutput: Uint8Array,
): Promise<string> {
  validatePrfOutput(prfOutput);
  const validatedVault = validateBiometricVault(vault);
  const kdfSalt = decodeBase64(validatedVault.kdfSalt, "Biometric vault KDF salt");
  const iv = decodeBase64(validatedVault.iv, "Biometric vault IV");
  const ciphertext = decodeBase64(
    validatedVault.ciphertext,
    "Biometric vault ciphertext",
  );

  if (kdfSalt.length !== KDF_SALT_LENGTH || iv.length !== IV_LENGTH) {
    throw new TypeError("Biometric vault salt or IV has an invalid length");
  }
  if (ciphertext.length < AES_TAG_LENGTH / 8) {
    throw new TypeError("Biometric vault ciphertext is too short");
  }

  const key = await deriveKey(prfOutput, kdfSalt);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: AES_TAG_LENGTH },
      key,
      ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      throw new BiometricVaultError();
    }
    throw error;
  }
}

export function validateBiometricVault(value: unknown): BiometricVault {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("credentialId" in value) ||
    !("rpId" in value) ||
    !("prfSalt" in value) ||
    !("kdfSalt" in value) ||
    !("iv" in value) ||
    !("ciphertext" in value)
  ) {
    throw new TypeError("Biometric vault has an invalid structure");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== VAULT_VERSION ||
    !isNonEmptyString(candidate.credentialId) ||
    !isNonEmptyString(candidate.rpId) ||
    !isNonEmptyString(candidate.prfSalt) ||
    !isNonEmptyString(candidate.kdfSalt) ||
    !isNonEmptyString(candidate.iv) ||
    !isNonEmptyString(candidate.ciphertext) ||
    (candidate.createdAt !== undefined &&
      typeof candidate.createdAt !== "number")
  ) {
    throw new TypeError("Biometric vault has an unsupported or invalid structure");
  }

  return {
    version: VAULT_VERSION,
    credentialId: candidate.credentialId,
    rpId: candidate.rpId,
    prfSalt: candidate.prfSalt,
    kdfSalt: candidate.kdfSalt,
    iv: candidate.iv,
    ciphertext: candidate.ciphertext,
    createdAt:
      typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validatePrfOutput(prfOutput: Uint8Array): void {
  if (prfOutput.length < MIN_PRF_OUTPUT_LENGTH) {
    throw new RangeError("PRF output is too short to derive a key");
  }
}

function validatePrfSalt(prfSalt: Uint8Array): void {
  if (prfSalt.length !== PRF_SALT_LENGTH) {
    throw new RangeError(`PRF salt must be ${PRF_SALT_LENGTH} bytes`);
  }
}

async function deriveKey(
  prfOutput: Uint8Array,
  kdfSalt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(prfOutput),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: kdfSalt,
      info: new TextEncoder().encode(HKDF_INFO),
    },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}
