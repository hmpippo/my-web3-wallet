const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Encodes bytes as standard base64, as used by the encrypted vault. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decodes standard base64, rejecting empty, unpadded, or malformed input. */
export function decodeBase64(
  value: string,
  field: string,
): Uint8Array<ArrayBuffer> {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new TypeError(`${field} is not valid base64`);
  }
  return base64ToBytes(value);
}

/** Encodes bytes as unpadded base64url, as used by WebAuthn credential ids. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decodes unpadded base64url, rejecting empty or malformed input. */
export function decodeBase64Url(
  value: string,
  field: string,
): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new TypeError(`${field} is not valid base64url`);
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = standard.length % 4;
  if (remainder === 1) {
    throw new TypeError(`${field} is not valid base64url`);
  }
  return base64ToBytes(standard + "=".repeat((4 - remainder) % 4));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
