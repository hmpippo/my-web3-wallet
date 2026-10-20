import { beforeEach, describe, expect, it, vi } from "vitest";

const { readContract } = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ readContract }),
}));

import {
  normalizeNftAddress,
  parseNftTokenId,
  readNftMetadata,
  readNftOwnership,
  resolveNftUri,
} from "./nft-service";

const CONTRACT = "0x0000000000000000000000000000000000000001";
const OWNER = "0x60228AbA7961736d16C7b9Ed4D109c8749D4fb35";
const OTHER_OWNER = "0x79eA449c3375eD1a9D7D99f8068209ea748C6d42";
const SEPOLIA = 11155111;

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

  it("keeps IPFS query and fragment, accepts AR URIs, and repairs scheme-less hosts", () => {
    expect(resolveNftUri("IPFS://bafybeig/metadata.json?v=2#top")).toBe(
      "https://ipfs.io/ipfs/bafybeig/metadata.json?v=2#top",
    );
    expect(resolveNftUri("ar://txid123/image.png")).toBe(
      "https://arweave.net/txid123/image.png",
    );
    expect(resolveNftUri("ens-metadata-service.appspot.com/name/0x01")).toBe(
      "https://ens-metadata-service.appspot.com/name/0x01",
    );
    expect(resolveNftUri("1.png", "https://example.com/nft/1.json")).toBe(
      "https://example.com/nft/1.png",
    );
    expect(() => resolveNftUri("ipfs://ipfs//bafy/1.json")).toThrow(
      "invalid IPFS",
    );
    expect(() => resolveNftUri("javascript:alert(1)")).toThrow("public HTTPS");
  });

  it("decodes inline data: token URIs without a network request", async () => {
    const metadata = {
      name: "Inline NFT",
      description: "On-chain metadata",
      image: "data:image/svg+xml;base64,PHN2Zy8+",
    };
    readContract.mockResolvedValueOnce(
      `data:application/json;base64,${Buffer.from(
        JSON.stringify(metadata),
      ).toString("base64")}`,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("9"), "ERC-721", SEPOLIA),
    ).resolves.toEqual({
      chainId: SEPOLIA,
      address: CONTRACT,
      tokenId: "9",
      standard: "ERC-721",
      name: "Inline NFT",
      description: "On-chain metadata",
      imageUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes utf8 inline metadata and caps the inline payload size", async () => {
    readContract.mockResolvedValueOnce(
      `data:application/json;utf8,${encodeURIComponent(
        JSON.stringify({ name: "Utf8 NFT" }),
      )}`,
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("3"), "ERC-721", SEPOLIA),
    ).resolves.toMatchObject({ name: "Utf8 NFT", imageUrl: null });

    readContract.mockResolvedValueOnce(
      `data:application/json;base64,${Buffer.from(
        "x".repeat(256 * 1024 + 1),
      ).toString("base64")}`,
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("4"), "ERC-721", SEPOLIA),
    ).rejects.toThrow("256 KiB");
  });

  it("handles scheme-less 0x{id} ERC-1155 metadata URIs", async () => {
    readContract.mockResolvedValueOnce(
      "ens-metadata-service.appspot.com/name/0x{id}",
    );
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ name: "alice.eth" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-1155", SEPOLIA),
    ).resolves.toMatchObject({ name: "alice.eth", imageUrl: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ens-metadata-service.appspot.com/name/0x01",
      expect.objectContaining({
        redirect: "follow",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("resolves relative image links and keeps the NFT when the image is unusable", async () => {
    readContract.mockResolvedValueOnce("https://example.com/nft/1.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ name: "Relative", image: "./art/1.png" }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721", SEPOLIA),
    ).resolves.toMatchObject({
      name: "Relative",
      imageUrl: "https://example.com/nft/art/1.png",
    });

    readContract.mockResolvedValueOnce("https://example.com/nft/2.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "No art",
            image: "javascript:alert(1)",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("2"), "ERC-721", SEPOLIA),
    ).resolves.toMatchObject({ name: "No art", imageUrl: null });
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
        SEPOLIA,
      ),
    ).resolves.toEqual({
      chainId: SEPOLIA,
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
        SEPOLIA,
      ),
    ).resolves.toMatchObject({
      tokenId: "42",
      standard: "ERC-1155",
      name: "Multi Token",
      imageUrl: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.com/${"0".repeat(62)}2a.json`,
      expect.objectContaining({ redirect: "follow" }),
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
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721", SEPOLIA),
    ).rejects.toThrow("HTTPS or ipfs");
    expect(fetchMock).not.toHaveBeenCalled();

    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(256 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("1"), "ERC-721", SEPOLIA),
    ).rejects.toThrow("256 KiB");
  });

  it("returns a local message when metadata fetching fails", async () => {
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch from evil.example");
      }),
    );

    const error = await readNftMetadata(
      normalizeNftAddress(CONTRACT),
      BigInt("1"),
      "ERC-721",
      SEPOLIA,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "NFT metadata request failed (network or CORS error).",
    );
    expect((error as Error).message).not.toContain("evil.example");
  });

  it("does not reflect provider text from the tokenURI read", async () => {
    const providerError = new Error("rpc detail: visit evil.example");
    readContract.mockRejectedValueOnce(providerError);

    const error = await readNftMetadata(
      normalizeNftAddress(CONTRACT),
      BigInt("1"),
      "ERC-721",
      SEPOLIA,
    ).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "NFT metadata could not be loaded. Check the contract, token ID, and metadata availability, then retry.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);
  });

  it("does not reflect a dropped metadata stream", async () => {
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("socket detail: evil.example"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(broken, {
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const error = await readNftMetadata(
      normalizeNftAddress(CONTRACT),
      BigInt("1"),
      "ERC-721",
      SEPOLIA,
    ).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "NFT metadata request failed (network or CORS error).",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it("rejects redirects that leave the public HTTPS web", async () => {
    const privateRedirect = new Response(JSON.stringify({ name: "x" }), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(privateRedirect, "url", {
      value: "https://localhost/metadata.json",
    });
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal("fetch", vi.fn(async () => privateRedirect));

    await expect(
      readNftMetadata(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        SEPOLIA,
      ),
    ).rejects.toThrow("redirected to an unsupported URL");

    const cleartextRedirect = new Response(JSON.stringify({ name: "x" }), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(cleartextRedirect, "url", {
      value: "http://127.0.0.1/metadata.json",
    });
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal("fetch", vi.fn(async () => cleartextRedirect));

    await expect(
      readNftMetadata(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        SEPOLIA,
      ),
    ).rejects.toThrow("redirected to an unsupported URL");
  });

  it("accepts a redirect to another public HTTPS host", async () => {
    const redirected = new Response(JSON.stringify({ name: "Redirected NFT" }), {
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(redirected, "url", {
      value: "https://ipfs.io/ipfs/bafy/metadata.json",
    });
    readContract.mockResolvedValueOnce("https://example.com/metadata.json");
    vi.stubGlobal("fetch", vi.fn(async () => redirected));

    await expect(
      readNftMetadata(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        SEPOLIA,
      ),
    ).resolves.toMatchObject({ name: "Redirected NFT" });
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
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("7"), "ERC-721", SEPOLIA),
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
      readNftMetadata(normalizeNftAddress(CONTRACT), BigInt("7"), "ERC-721", SEPOLIA),
    ).rejects.toThrow("not valid JSON");
  });
});

describe("NFT ownership reads", () => {
  beforeEach(() => {
    readContract.mockReset();
    vi.unstubAllGlobals();
  });

  it("treats an ERC-721 owner match as owned, ignoring address casing", async () => {
    readContract.mockResolvedValueOnce(OWNER);
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        OWNER,
        SEPOLIA,
      ),
    ).resolves.toBe(true);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT,
        functionName: "ownerOf",
        args: [BigInt("1")],
      }),
    );

    readContract.mockResolvedValueOnce(OWNER.toLowerCase());
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        OWNER.toLowerCase() as `0x${string}`,
        SEPOLIA,
      ),
    ).resolves.toBe(true);
  });

  it("reports an ERC-721 token held by another account as not owned", async () => {
    readContract.mockResolvedValueOnce(OTHER_OWNER);
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        OWNER,
        SEPOLIA,
      ),
    ).resolves.toBe(false);
  });

  it("uses the ERC-1155 balance for the owner and token ID", async () => {
    readContract.mockResolvedValueOnce(BigInt("0"));
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("42"),
        "ERC-1155",
        OWNER,
        SEPOLIA,
      ),
    ).resolves.toBe(false);

    readContract.mockResolvedValueOnce(BigInt("1"));
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("42"),
        "ERC-1155",
        OWNER,
        SEPOLIA,
      ),
    ).resolves.toBe(true);
    expect(readContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: CONTRACT,
        functionName: "balanceOf",
        args: [OWNER, BigInt("42")],
      }),
    );

    readContract.mockResolvedValueOnce(BigInt("7"));
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("42"),
        "ERC-1155",
        OWNER,
        SEPOLIA,
      ),
    ).resolves.toBe(true);
  });

  it("rejects instead of guessing when ownership cannot be determined", async () => {
    const providerError = new Error("execution reverted: evil.example");
    readContract.mockRejectedValueOnce(providerError);
    const error = await readNftOwnership(
      normalizeNftAddress(CONTRACT),
      BigInt("1"),
      "ERC-721",
      OWNER,
      SEPOLIA,
    ).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe(
      "Could not verify NFT ownership on chain.",
    );
    expect((error as Error).message).not.toContain("evil.example");
    expect((error as Error).cause).toBe(providerError);

    readContract.mockResolvedValueOnce(BigInt("1"));
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-721",
        OWNER,
        SEPOLIA,
      ),
    ).rejects.toThrow("owner address");

    readContract.mockResolvedValueOnce("1");
    await expect(
      readNftOwnership(
        normalizeNftAddress(CONTRACT),
        BigInt("1"),
        "ERC-1155",
        OWNER,
        SEPOLIA,
      ),
    ).rejects.toThrow("ERC-1155 balance");
  });
});
