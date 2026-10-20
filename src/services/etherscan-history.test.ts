import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBlockNumber } = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/chain", () => ({
  getPublicClient: () => ({ getBlockNumber }),
  getChain: (chainId: number) => ({
    id: chainId,
    name: chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`,
  }),
  supportsHistory: (chainId: number) => chainId !== 8453,
}));

import {
  getEtherscanHistory,
  HistoryServiceError,
} from "./etherscan-history";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const SENDER = "0x0000000000000000000000000000000000000002";
const RECIPIENT = "0x0000000000000000000000000000000000000003";
const TOKEN = "0x0000000000000000000000000000000000000004";
const API_KEY = "test-only-etherscan-key";
const CURSOR_SECRET = "cursor-test-secret-0123456789abcdef";
const SEPOLIA = 11155111;

type Kind = "normal" | "internal" | "erc20";

/** Calls the service on Sepolia unless a chain override is supplied. */
function history(
  address: string,
  cursor: string | null = null,
  kind: Kind | "all" = "all",
  chainId: number = SEPOLIA,
) {
  return getEtherscanHistory(address as `0x${string}`, cursor, kind, chainId);
}

function record(kind: Kind, timestamp: number, index: number) {
  const common = {
    blockNumber: String(timestamp),
    timeStamp: String(timestamp),
    hash: `0x${index.toString(16).padStart(64, "0")}`,
    from: SENDER,
    to: RECIPIENT,
    value: "1000000000000000000",
  };
  if (kind === "internal") {
    return { ...common, traceId: String(index), isError: "0" };
  }
  if (kind === "erc20") {
    return {
      ...common,
      contractAddress: TOKEN,
      tokenName: "Test Token",
      tokenSymbol: "TST",
      tokenDecimal: "6",
      transactionIndex: "0",
    };
  }
  return {
    ...common,
    transactionIndex: "0",
    isError: "0",
    txreceipt_status: "1",
  };
}

function makeResponse(
  status: "0" | "1",
  result: unknown,
  message = status === "1" ? "OK" : "NOTOK",
): Response {
  return Response.json({ status, message, result });
}

describe("Etherscan history service", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let records: Record<Kind, ReturnType<typeof record>[]>;

  beforeEach(() => {
    process.env.ETHERSCAN_API_KEY = API_KEY;
    process.env.HISTORY_CURSOR_SECRET = CURSOR_SECRET;
    getBlockNumber.mockResolvedValue(BigInt(11925000));
    records = {
      normal: Array.from({ length: 20 }, (_, index) =>
        record("normal", 200 - index, index + 1),
      ),
      internal: [record("internal", 199, 101), record("internal", 179, 102)],
      erc20: [
        record("erc20", 198, 201),
        record("erc20", 178, 202),
        record("erc20", 177, 203),
      ],
    };

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const action = url.searchParams.get("action");
      const kind: Kind =
        action === "txlistinternal"
          ? "internal"
          : action === "tokentx"
            ? "erc20"
            : "normal";
      const page = Number(url.searchParams.get("page"));
      const offset = Number(url.searchParams.get("offset"));
      const start = (page - 1) * offset;
      const pageRecords = records[kind].slice(start, start + offset);
      return pageRecords.length > 0
        ? makeResponse("1", pageRecords)
        : makeResponse("0", "No transactions found", "No transactions found");
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.ETHERSCAN_API_KEY;
    delete process.env.HISTORY_CURSOR_SECRET;
    vi.unstubAllEnvs();
    getBlockNumber.mockReset();
    vi.unstubAllGlobals();
  });

  it("uses the fixed Sepolia V2 endpoints and normalizes all activity kinds", async () => {
    const result = await history(ADDRESS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestedUrls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(requestedUrls.map((url) => url.searchParams.get("action")).sort()).toEqual([
      "tokentx",
      "txlist",
      "txlistinternal",
    ]);
    for (const url of requestedUrls) {
      expect(url.origin + url.pathname).toBe("https://api.etherscan.io/v2/api");
      expect(url.searchParams.get("chainid")).toBe("11155111");
      expect(url.searchParams.get("module")).toBe("account");
      expect(url.searchParams.get("address")).toBe(ADDRESS);
      expect(url.searchParams.get("endblock")).toBe("11925000");
      expect(url.searchParams.get("sort")).toBe("desc");
      expect(url.searchParams.get("apikey")).toBe(API_KEY);
    }

    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toMatchObject({
      kind: "normal",
      blockNumber: "200",
      status: "success",
      value: "1000000000000000000",
    });
    expect(result.items.map((item) => item.timestamp)).toEqual(
      [...result.items.map((item) => item.timestamp)].sort((a, b) => b - a),
    );
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.items.some((item) => item.kind === "internal")).toBe(true);
    expect(result.items.some((item) => item.kind === "erc20")).toBe(true);
    expect(result.items.find((item) => item.kind === "erc20")?.token).toEqual({
      contractAddress: TOKEN,
      name: "Test Token",
      symbol: "TST",
      decimals: 6,
    });
  });

  it("coalesces concurrent requests for the same wallet page", async () => {
    const [first, second] = await Promise.all([
          history(ADDRESS),
          history(ADDRESS),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fetches only the selected activity source for a tab", async () => {
    const result = await history(ADDRESS, null, "erc20");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("action")).toBe("tokentx");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.kind === "erc20")).toBe(true);
  });

  it("merges independently paginated sources without skipping or duplicating rows", async () => {
    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let loaded = 0;

    do {
      const page = await history(ADDRESS, cursor);
      for (const item of page.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }
      loaded += page.items.length;
      cursor = page.nextCursor;
      if (loaded === 10) {
        getBlockNumber.mockResolvedValue(BigInt(11925001));
      }
    } while (cursor);

    expect(loaded).toBe(25);
    expect(seenIds.size).toBe(25);
    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([input]) =>
      new URL(String(input)).searchParams.get("endblock") === "11925000"
    )).toBe(true);
  });

  it("distinguishes a valid empty result from an API error", async () => {
    records = { normal: [], internal: [], erc20: [] };
    await expect(history(ADDRESS)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.searchParams.get("action") === "txlist") {
        return makeResponse("0", "Invalid API Key");
      }
      return makeResponse("0", "No transactions found", "No transactions found");
    });
    await expect(history(ADDRESS)).rejects.toMatchObject({
      code: "provider",
    });
  });

  it("surfaces provider rate limiting explicitly", async () => {
    fetchMock.mockImplementation(async () =>
      makeResponse("0", "Max rate limit reached", "NOTOK"),
    );
    await expect(history(ADDRESS)).rejects.toMatchObject({
      code: "rate-limit",
    });
  });

  it("rejects a modified or wrong-address cursor", async () => {
    const firstPage = await history(ADDRESS);
    const cursor = firstPage.nextCursor!;
    const signatureStart = cursor.lastIndexOf(".") + 1;
    const tamperedCursor = `${cursor.slice(0, signatureStart)}${cursor[signatureStart] === "A" ? "B" : "A"}${cursor.slice(signatureStart + 1)}`;

    await expect(
      history(ADDRESS, tamperedCursor),
    ).rejects.toBeInstanceOf(HistoryServiceError);
    await expect(
      history(RECIPIENT, cursor),
    ).rejects.toMatchObject({ code: "cursor" });
    await expect(
      history(ADDRESS, cursor, "internal"),
    ).rejects.toMatchObject({ code: "cursor" });
  });

  it("requires a server-side Etherscan API key", async () => {
    delete process.env.ETHERSCAN_API_KEY;
    await expect(history(ADDRESS)).rejects.toMatchObject({
      code: "missing-key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cursors after the cursor secret changes", async () => {
    const firstPage = await history(ADDRESS);
    const cursor = firstPage.nextCursor!;
    expect(cursor).toBeTruthy();

    process.env.HISTORY_CURSOR_SECRET = `${CURSOR_SECRET}-rotated`;

    await expect(history(ADDRESS, cursor)).rejects.toMatchObject({
      code: "cursor",
    });
  });

  it("falls back to the API key outside production", async () => {
    delete process.env.HISTORY_CURSOR_SECRET;

    const page = await history(ADDRESS);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("requires a cursor secret in production", async () => {
    delete process.env.HISTORY_CURSOR_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    await expect(history(ADDRESS)).rejects.toMatchObject({ code: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cursor secret that is too short", async () => {
    process.env.HISTORY_CURSOR_SECRET = "too-short";

    await expect(history(ADDRESS)).rejects.toMatchObject({ code: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports chains without free-tier history without contacting the provider", async () => {
    await expect(history(ADDRESS, null, "all", 8453)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
