import { describe, expect, it } from "vitest";
import { encodeVaultSecret, parseVaultSecret } from "./vault-secret";

const MNEMONIC =
  "test test test test test test test test test test test junk";
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("vault secret", () => {
  it("round-trips a recovery phrase and a private key", () => {
    expect(
      parseVaultSecret(encodeVaultSecret({ kind: "mnemonic", secret: MNEMONIC })),
    ).toEqual({ kind: "mnemonic", secret: MNEMONIC });
    expect(
      parseVaultSecret(
        encodeVaultSecret({ kind: "privateKey", secret: PRIVATE_KEY }),
      ),
    ).toEqual({ kind: "privateKey", secret: PRIVATE_KEY });
  });

  it("serializes the secret with its kind", () => {
    expect(
      JSON.parse(encodeVaultSecret({ kind: "privateKey", secret: PRIVATE_KEY })),
    ).toEqual({ version: 1, kind: "privateKey", secret: PRIVATE_KEY });
  });

  it("reads a bare recovery phrase as a mnemonic for legacy vaults", () => {
    expect(parseVaultSecret(MNEMONIC)).toEqual({
      kind: "mnemonic",
      secret: MNEMONIC,
    });
    expect(parseVaultSecret(`  ${MNEMONIC}\n`)).toEqual({
      kind: "mnemonic",
      secret: MNEMONIC,
    });
  });

  it("falls back to a mnemonic for malformed or unrecognized payloads", () => {
    expect(parseVaultSecret("{ not json")).toEqual({
      kind: "mnemonic",
      secret: "{ not json",
    });
    expect(
      parseVaultSecret('{"kind":"somethingElse","secret":"value"}'),
    ).toEqual({
      kind: "mnemonic",
      secret: '{"kind":"somethingElse","secret":"value"}',
    });
    expect(parseVaultSecret('{"kind":"privateKey","secret":""}')).toEqual({
      kind: "mnemonic",
      secret: '{"kind":"privateKey","secret":""}',
    });
  });
});
