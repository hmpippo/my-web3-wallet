import { beforeEach, describe, expect, it, vi } from "vitest";

const { readContract } = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

vi.mock("@/core/chain", () => ({
  publicClient: { readContract },
}));

import {
  normalizeNftAddress,
  parseNftTokenId,
  readNftMetadata,
  resolveNftUri,
} from "./nft-service";

const CONTRACT = "0x0000000000000000000000000000000000000001";

describe("NFT metadata service", () => {
  beforeEach(() => {
    readContract.mockReset();
    vi.unstubAllGlobals();
  });

  it("validates contract addresses and unsigned decimal token IDs", () => {
    expect(normalizeNftAddress(CONTRACT)).toBe(CONTRACT);
    expect(() => normalizeNftAddress("not-an-address")).toThrow(
      "valid NFT contract address",
    );
    expect(parseNftTokenId("00042")).toBe(BigInt("42"));
    expect(() => parseNftTokenId("-1")).toThrow("decimal integer");
    expect(() => parseNftTokenId("1e4")).toThrow("decimal integer");
    expect(() =>
      parseNftTokenId("115792089237316195423570985008687907853269984665640564039457584007913129639936"),
    ).toThrow("unsigned 256-bit");
  });

  it("resolves IPFS URIs to the public HTTPS gateway and rejects unsafe schemes", () => {
    expect(resolveNftUri("ipfs://ipfs/bafy/test image.json")).toBe(
      "https://ipfs.io/ipfs/bafy/test%20image.json",
    );
    expect(resolveNftUri("https://example.com/metadata.json")).toBe(
      "https://example.com/metadata.json",
    );
    expect(() => resolveNftUri("http://example.com/metadata.json")).toThrow(
      "public HTTPS",
    );
    expect(() => resolveNftUri("https://localhost/metadata.json")).toThrow(
      "public HTTPS",
    );
  });

  it("reads ERC-721 tokenURI and safely extracts metadata", async () => {
    readContract.mockResolvedValueOnce("https://example.com/1.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "Example NFT",
            description: "Plain text details",
            image: "ipfs://bafy/image.png",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      readNftMetadata(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
      ),
    ).resolves.toEqual({
      address: CONTRACT,
      tokenId: "1",
      standard: "ERC-721",
      name: "Example NFT",
      description: "Plain text details",
      imageUrl: "https://ipfs.io/ipfs/bafy/image.png",
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "tokenURI",
        args: [BigInt("1")],
      }),
    );
  });

  it("substitutes a padded lowercase ERC-1155 token ID in the metadata URI", async () => {
    readContract.mockResolvedValueOnce("https://example.com/{id}.json");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ name: "Multi Token" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readNftMetadata(
        normalizeNftAddress(CONTRACT),
        BigInt("42"),
        "ERC-1155",
      ),
    ).resolves.toMatchObject({
      tokenId: "42",
      standard: "ERC-1155",
      name: "Multi Token",
      imageUrl: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.com/${"0".repeat(62)}2a.json`,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "uri",
        args: [BigInt("42")],
      }),
    );
  });

  it("does not fetch rejected URI schemes or oversized metadata", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    readContract.mockResolvedValueOnce("http://example.com/metadata.json");
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721"),
    ).rejects.toThrow("HTTPS or ipfs");
    expect(fetchMock).not.toHaveBeenCalled();

    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(256 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721"),
    ).rejects.toThrow("256 KiB");
  });

  it("returns an actionable retry message when metadata fetching fails", async () => {
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721"),
    ).rejects.toThrow(/could not be loaded.*retry/i);
  });

  it("uses a readable fallback name and surfaces invalid JSON", async () => {
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ description: "No title" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("7"), "ERC-721"),
    ).resolves.toMatchObject({
      name: "ERC-721 #7",
    });

    readContract.mockResolvedValueOnce("https://example.com/bad.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{", { headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("7"), "ERC-721"),
    ).rejects.toThrow("not valid JSON");
  });
});
