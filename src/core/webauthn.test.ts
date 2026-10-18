import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBase64Url } from "@/lib/base64";
import {
  BiometricUnlockCancelledError,
  BiometricUnlockUnsupportedError,
  evaluatePrf,
  isBiometricUnlockSupported,
  registerBiometricCredential,
} from "./webauthn";

const CREDENTIAL_ID_BYTES = new Uint8Array([1, 2, 3, 4]);
const CREDENTIAL_ID = encodeBase64Url(CREDENTIAL_ID_BYTES);
const PRF_SALT = new Uint8Array(32);

function prfCredential(
  options: {
    enabled?: boolean;
    first?: Uint8Array | null;
    rawId?: Uint8Array<ArrayBuffer>;
  } = {},
) {
  const {
    enabled = true,
    first = new Uint8Array(32).fill(5),
    rawId = CREDENTIAL_ID_BYTES,
  } = options;
  return {
    type: "public-key",
    rawId: rawId.buffer,
    getClientExtensionResults: () => ({
      prf: { enabled, results: first ? { first: first.buffer } : undefined },
    }),
  };
}

function stubCredentials(create: unknown, get: unknown): void {
  vi.stubGlobal("navigator", { credentials: { create, get } });
}

describe("webauthn biometric unlock", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports support only in a secure context with a platform authenticator", async () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });
    await expect(isBiometricUnlockSupported()).resolves.toBe(false);

    vi.stubGlobal("window", { isSecureContext: true });
    await expect(isBiometricUnlockSupported()).resolves.toBe(true);

    vi.stubGlobal("PublicKeyCredential", {});
    await expect(isBiometricUnlockSupported()).resolves.toBe(false);

    vi.stubGlobal("PublicKeyCredential", undefined);
    await expect(isBiometricUnlockSupported()).resolves.toBe(false);
  });

  it("registers a user-verified platform credential and returns the PRF output", async () => {
    let creationOptions: CredentialCreationOptions | undefined;
    const create = vi.fn(async (options: CredentialCreationOptions) => {
      creationOptions = options;
      return prfCredential({ first: new Uint8Array(32).fill(9) });
    });
    stubCredentials(create, vi.fn());

    const result = await registerBiometricCredential({
      rpId: "localhost",
      userName: "0xabc",
      prfSalt: PRF_SALT,
    });

    expect(result.credentialId).toBe(CREDENTIAL_ID);
    expect(result.prfOutput[0]).toBe(9);
    expect(creationOptions?.publicKey?.rp.id).toBe("localhost");
    expect(creationOptions?.publicKey?.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    });
    expect(creationOptions?.publicKey?.attestation).toBe("none");
  });

  it("evaluates the PRF with an assertion when creation omits the result", async () => {
    const get = vi.fn(async () => prfCredential({ first: new Uint8Array(32).fill(3) }));
    stubCredentials(vi.fn(async () => prfCredential({ first: null })), get);

    const result = await registerBiometricCredential({
      rpId: "localhost",
      userName: "0xabc",
      prfSalt: PRF_SALT,
    });

    expect(result.prfOutput[0]).toBe(3);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects creation when the authenticator cannot provide a PRF output", async () => {
    stubCredentials(vi.fn(async () => prfCredential({ enabled: false })), vi.fn());

    await expect(
      registerBiometricCredential({
        rpId: "localhost",
        userName: "0xabc",
        prfSalt: PRF_SALT,
      }),
    ).rejects.toBeInstanceOf(BiometricUnlockUnsupportedError);
  });

  it("translates a user cancellation into a cancelled error", async () => {
    stubCredentials(
      vi.fn(async () => {
        throw new DOMException("cancelled", "NotAllowedError");
      }),
      vi.fn(),
    );

    await expect(
      registerBiometricCredential({
        rpId: "localhost",
        userName: "0xabc",
        prfSalt: PRF_SALT,
      }),
    ).rejects.toBeInstanceOf(BiometricUnlockCancelledError);
  });

  it("evaluates the PRF for an existing credential during an assertion", async () => {
    let requestOptions: CredentialRequestOptions | undefined;
    const get = vi.fn(async (options: CredentialRequestOptions) => {
      requestOptions = options;
      return prfCredential({ first: new Uint8Array(32).fill(4) });
    });
    stubCredentials(vi.fn(), get);

    const output = await evaluatePrf({
      credentialId: CREDENTIAL_ID,
      prfSalt: PRF_SALT,
      rpId: "localhost",
    });

    expect(output[0]).toBe(4);
    expect(requestOptions?.publicKey?.userVerification).toBe("required");
    expect(requestOptions?.publicKey?.rpId).toBe("localhost");
    expect(requestOptions?.publicKey?.allowCredentials?.[0]?.id).toEqual(
      CREDENTIAL_ID_BYTES,
    );
  });

  it("rejects an assertion that lacks a PRF result", async () => {
    stubCredentials(vi.fn(), vi.fn(async () => prfCredential({ first: null })));

    await expect(
      evaluatePrf({
        credentialId: CREDENTIAL_ID,
        prfSalt: PRF_SALT,
        rpId: "localhost",
      }),
    ).rejects.toBeInstanceOf(BiometricUnlockUnsupportedError);
  });
});
