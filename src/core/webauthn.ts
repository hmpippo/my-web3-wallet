import { decodeBase64Url, encodeBase64Url } from "@/lib/base64";

const RP_NAME = "My Wallet";
const TIMEOUT_MS = 60_000;
const CHALLENGE_LENGTH = 32;
const USER_ID_LENGTH = 32;

export class BiometricUnlockUnsupportedError extends Error {
  constructor(message = "Biometric unlock is not supported on this device.") {
    super(message);
    this.name = "BiometricUnlockUnsupportedError";
  }
}

export class BiometricUnlockCancelledError extends Error {
  constructor(message = "Biometric unlock was cancelled.") {
    super(message);
    this.name = "BiometricUnlockCancelledError";
  }
}

export interface RegisteredBiometricCredential {
  credentialId: string;
  prfOutput: Uint8Array;
}

interface PrfResults {
  enabled?: boolean;
  first?: Uint8Array;
}

/**
 * Whether this browser can run a platform-authenticator (Touch ID / Face ID)
 * ceremony at all. WebAuthn needs a secure context, so plain-http origins are
 * rejected up front.
 */
export async function isBiometricUnlockSupported(): Promise<boolean> {
  if (typeof window === "undefined" || window.isSecureContext !== true) {
    return false;
  }
  if (typeof PublicKeyCredential === "undefined") return false;
  const available =
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof available !== "function") return false;
  try {
    return await available.call(PublicKeyCredential);
  } catch {
    return false;
  }
}

/**
 * Creates a discoverable, user-verified platform credential and evaluates the
 * WebAuthn PRF extension, returning the deterministic secret used to wrap the
 * recovery phrase. Throws `BiometricUnlockUnsupportedError` when the
 * authenticator cannot provide a PRF output, so callers never persist a vault
 * they cannot later decrypt.
 */
export async function registerBiometricCredential(options: {
  rpId: string;
  userName: string;
  prfSalt: Uint8Array;
}): Promise<RegisteredBiometricCredential> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { id: options.rpId, name: RP_NAME },
    user: {
      id: crypto.getRandomValues(new Uint8Array(USER_ID_LENGTH)),
      name: options.userName,
      displayName: options.userName,
    },
    challenge: crypto.getRandomValues(new Uint8Array(CHALLENGE_LENGTH)),
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
    timeout: TIMEOUT_MS,
    extensions: prfExtension(options.prfSalt),
  };

  const credential = await createCredential({ publicKey });
  const credentialId = encodeBase64Url(new Uint8Array(credential.rawId));
  const results = readPrfResults(credential);
  if (results.enabled === false) {
    throw new BiometricUnlockUnsupportedError();
  }
  if (results.first) return { credentialId, prfOutput: results.first };

  // Some authenticators only evaluate the PRF during an assertion, so confirm
  // the secret is retrievable before the caller stores anything.
  const prfOutput = await evaluatePrf({
    credentialId,
    prfSalt: options.prfSalt,
    rpId: options.rpId,
  });
  return { credentialId, prfOutput };
}

/** Evaluates the PRF extension for an existing credential via an assertion. */
export async function evaluatePrf(options: {
  credentialId: string;
  prfSalt: Uint8Array;
  rpId: string;
}): Promise<Uint8Array> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(CHALLENGE_LENGTH)),
    rpId: options.rpId,
    allowCredentials: [
      {
        type: "public-key",
        id: decodeBase64Url(options.credentialId, "Credential id"),
      },
    ],
    userVerification: "required",
    timeout: TIMEOUT_MS,
    extensions: prfExtension(options.prfSalt),
  };

  const assertion = await getAssertion({ publicKey });
  const results = readPrfResults(assertion);
  if (results.enabled === false) {
    throw new BiometricUnlockUnsupportedError();
  }
  if (!results.first) {
    throw new BiometricUnlockUnsupportedError(
      "Biometric unlock did not return a PRF result.",
    );
  }
  return results.first;
}

function prfExtension(
  prfSalt: Uint8Array,
): AuthenticationExtensionsClientInputs {
  // The PRF extension is not in every TypeScript DOM lib version.
  return {
    prf: { eval: { first: prfSalt } },
  } as unknown as AuthenticationExtensionsClientInputs;
}

function readPrfResults(credential: PublicKeyCredential): PrfResults {
  const extensions = credential.getClientExtensionResults() as unknown as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const first = extensions.prf?.results?.first;
  return {
    enabled: extensions.prf?.enabled,
    first: first ? new Uint8Array(first) : undefined,
  };
}

async function createCredential(
  options: CredentialCreationOptions,
): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create(options);
  } catch (error) {
    throw translateError(error);
  }
  if (!credential || credential.type !== "public-key") {
    throw new BiometricUnlockCancelledError();
  }
  return credential as PublicKeyCredential;
}

async function getAssertion(
  options: CredentialRequestOptions,
): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get(options);
  } catch (error) {
    throw translateError(error);
  }
  if (!credential || credential.type !== "public-key") {
    throw new BiometricUnlockCancelledError();
  }
  return credential as PublicKeyCredential;
}

function translateError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return new BiometricUnlockCancelledError();
    }
    if (error.name === "NotSupportedError" || error.name === "SecurityError") {
      return new BiometricUnlockUnsupportedError();
    }
    if (error.name === "InvalidStateError") {
      return new Error("A passkey for this wallet already exists on this device.");
    }
  }
  if (error instanceof Error) return error;
  return new Error("Biometric unlock failed.");
}
