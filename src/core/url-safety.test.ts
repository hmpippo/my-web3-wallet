import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_URL_LENGTH,
  isPrivateHostname,
  isSafeImageUri,
  parseSafeRemoteUrl,
} from "./url-safety";

describe("shared URL safety rules", () => {
  it("treats loopback, private, link-local, and CGNAT hosts as private", () => {
    for (const hostname of [
      "localhost",
      "app.localhost",
      "printer.local",
      "service.internal",
      "thing.home.arpa",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.10",
      "169.254.10.10",
      "172.16.0.1",
      "172.31.255.255",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "[::1]",
      "fe80::1",
      "fd00::1",
    ]) {
      expect(isPrivateHostname(hostname)).toBe(true);
    }
  });

  it("accepts public hosts, including ones that merely start with fc or fd", () => {
    for (const hostname of [
      "example.com",
      "fcc.example.com",
      "fdic.example.com",
      "172.32.0.1",
      "100.128.0.1",
      "ipfs.io",
    ]) {
      expect(isPrivateHostname(hostname)).toBe(false);
    }
  });

  it("only resolves public HTTPS URLs", () => {
    expect(parseSafeRemoteUrl("https://example.com/a.json")?.href).toBe(
      "https://example.com/a.json",
    );
    expect(
      parseSafeRemoteUrl("art/1.png", "https://example.com/nft/1.json")?.href,
    ).toBe("https://example.com/nft/art/1.png");
    expect(parseSafeRemoteUrl("http://example.com/a.json")).toBeNull();
    expect(parseSafeRemoteUrl("https://user:pass@example.com/a.json")).toBeNull();
    expect(parseSafeRemoteUrl("https://127.0.0.1/a.json")).toBeNull();
    expect(parseSafeRemoteUrl("not a url")).toBeNull();
    expect(parseSafeRemoteUrl(`https://example.com/${"a".repeat(5000)}`)).toBeNull();
  });

  it("accepts inline images and rejects other inline media", () => {
    expect(isSafeImageUri("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true);
    expect(isSafeImageUri("data:image/png,not-really-png")).toBe(true);
    expect(isSafeImageUri("data:application/json;base64,eyJhIjoxfQ==")).toBe(false);
    expect(isSafeImageUri("data:;base64,PHN2Zy8+")).toBe(false);
    expect(isSafeImageUri("https://example.com/a.png")).toBe(true);
    expect(isSafeImageUri("http://example.com/a.png")).toBe(false);
    expect(
      isSafeImageUri(`data:image/png;base64,${"a".repeat(MAX_IMAGE_URL_LENGTH)}`),
    ).toBe(false);
  });
});
