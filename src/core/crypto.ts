import { decodeBase64, encodeBase64 } from "@/lib/base64";
import { MIN_PASSWORD_LENGTH } from "./password";

const VAULT_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AES_KEY_LENGTH = 256;
const AES_TAG_LENGTH = 128;

export interface EncryptedVault {
  version: typeof VAULT_VERSION;
  salt: string;
  iv: string;
  ciphertext: string;
}

export class VaultDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt vault. The password may be incorrect.");
    this.name = "VaultDecryptionError";
  }
}

export async function encryptVault(
  data: string,
  password: string,
): Promise<EncryptedVault> {
  if (data.length === 0) {
    throw new TypeError("Vault data must not be empty");
  }
  validatePassword(password);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: AES_TAG_LENGTH },
    key,
    new TextEncoder().encode(data),
  );

  return {
    version: VAULT_VERSION,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptVault(
  vault: EncryptedVault,
  password: string,
): Promise<string> {
  validatePassword(password);
  const validatedVault = validateVault(vault);
  const salt = decodeBase64(validatedVault.salt, "Vault salt");
  const iv = decodeBase64(validatedVault.iv, "Vault IV");
  const ciphertext = decodeBase64(validatedVault.ciphertext, "Vault ciphertext");

  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) {
    throw new TypeError("Vault salt or IV has an invalid length");
  }
  if (ciphertext.length < AES_TAG_LENGTH / 8) {
    throw new TypeError("Vault ciphertext is too short");
  }

  const key = await deriveKey(password, salt);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: AES_TAG_LENGTH },
      key,
      ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      throw new VaultDecryptionError();
    }
    throw error;
  }
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

function validateVault(value: unknown): EncryptedVault {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    !("salt" in value) ||
    !("iv" in value) ||
    !("ciphertext" in value)
  ) {
    throw new TypeError("Vault has an invalid structure");
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== VAULT_VERSION ||
    typeof candidate.salt !== "string" ||
    typeof candidate.iv !== "string" ||
    typeof candidate.ciphertext !== "string"
  ) {
    throw new TypeError("Vault has an unsupported or invalid structure");
  }

  return {
    version: VAULT_VERSION,
    salt: candidate.salt,
    iv: candidate.iv,
    ciphertext: candidate.ciphertext,
  };
}


