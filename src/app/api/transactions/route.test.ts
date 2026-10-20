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
  isSupportedChainId: (value: unknown) =>
    typeof value === "number" &&
    [1, 8453, 42161, 10, 137, 11155111, 84532].includes(value),
  supportsHistory: (chainId: number) => chainId !== 8453 && chainId !== 10,
}));

import {
  HISTORY_ADDRESS_LIMIT,
  HISTORY_IP_LIMIT,
  resetHistoryRateLimits,
} from "@/lib/history-rate-limit";
import { POST } from "./route";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const API_KEY = "route-test-secret";

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function addressAt(index: number): string {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

describe("transaction history route", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.ETHERSCAN_API_KEY = API_KEY;
    resetHistoryRateLimits();
    getBlockNumber.mockResolvedValue(BigInt(11925000));
    fetchMock = vi.fn(async () =>
      Response.json({
        status: "0",
        message: "No transactions found",
        result: "No transactions found",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.ETHERSCAN_API_KEY;
    getBlockNumber.mockReset();
    vi.unstubAllGlobals();
  });

  it("rejects invalid addresses and unknown request fields", async () => {
    const invalidAddress = await POST(makeRequest({ address: "not-an-address" }));
    expect(invalidAddress.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const extraField = await POST(makeRequest({ address: ADDRESS, chainId: 1 }));
    expect(extraField.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported chain ids", async () => {
    const response = await POST(makeRequest({ address: ADDRESS, chainid: 999999 }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a graceful unavailable payload for chains without free-tier history", async () => {
    const response = await POST(makeRequest({ address: ADDRESS, chainid: 8453 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      nextCursor: null,
      unavailable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes only the validated address and opaque cursor to the service", async () => {
    const response = await POST(
      makeRequest({ address: ADDRESS, cursor: null, chainid: 11155111 }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts a selected history kind and fetches only that source", async () => {
    const response = await POST(makeRequest({ address: ADDRESS, kind: "internal", chainid: 11155111 }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("action"))
      .toBe("txlistinternal");
  });

  it("rejects unknown history kinds", async () => {
    const response = await POST(makeRequest({ address: ADDRESS, kind: "nft", chainid: 11155111 }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps provider errors to sanitized responses", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      return url.searchParams.get("action") === "txlist"
        ? Response.json({ status: "0", message: "NOTOK", result: "Invalid API Key" })
        : Response.json({
            status: "0",
            message: "No transactions found",
            result: "No transactions found",
          });
    });

    const response = await POST(makeRequest({ address: ADDRESS, chainid: 11155111 }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("Could not load transaction history.");
    expect(body).not.toContain(API_KEY);
    expect(body).not.toContain("Invalid API Key");
  });

  it("returns a retryable status for provider rate limits", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        status: "0",
        message: "NOTOK",
        result: "Max rate limit reached",
      }),
    );

    const response = await POST(makeRequest({ address: ADDRESS, chainid: 11155111 }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "The history provider is busy. Try again shortly.",
    });
  });

  it("reports missing server configuration without contacting Etherscan", async () => {
    delete process.env.ETHERSCAN_API_KEY;

    const response = await POST(makeRequest({ address: ADDRESS, chainid: 11155111 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Transaction history is not configured on this server.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("transaction history route abuse controls", () => {
  beforeEach(() => {
    process.env.ETHERSCAN_API_KEY = API_KEY;
    resetHistoryRateLimits();
    getBlockNumber.mockResolvedValue(BigInt(11925000));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "0",
          message: "No transactions found",
          result: "No transactions found",
        }),
      ),
    );
  });

  afterEach(() => {
    delete process.env.ETHERSCAN_API_KEY;
    getBlockNumber.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when the cursor secret is missing in production", async () => {
    delete process.env.HISTORY_CURSOR_SECRET;
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(makeRequest({ address: ADDRESS, chainid: 1 }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Transaction history is not configured on this server.",
    });
  });

  it("rejects cross-site browser requests", async () => {
    const response = await POST(
      makeRequest(
        { address: ADDRESS, chainid: 1 },
        { "sec-fetch-site": "cross-site" },
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "The history request origin is not allowed.",
    });
  });

  it("rejects a mismatched Origin header", async () => {
    const response = await POST(
      makeRequest(
        { address: ADDRESS, chainid: 1 },
        { origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("accepts a same-origin request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "0",
          message: "No transactions found",
          result: "No transactions found",
        }),
      ),
    );

    const response = await POST(
      makeRequest(
        { address: ADDRESS, chainid: 1 },
        {
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
      ),
    );
    expect(response.status).toBe(200);
  });

  it("requires a JSON content type", async () => {
    const response = await POST(
      new Request("http://localhost/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rate-limits a burst from one IP across many addresses", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };

    for (let index = 0; index < HISTORY_IP_LIMIT; index += 1) {
      const response = await POST(
        makeRequest(
          { address: addressAt(index), chainid: 1 },
          headers,
        ),
      );
      expect(response.status).toBe(200);
    }

    const blocked = await POST(
      makeRequest({ address: addressAt(HISTORY_IP_LIMIT), chainid: 1 }, headers),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(await blocked.json()).toEqual({
      error: "Too many history requests. Try again shortly.",
    });

    const otherIp = await POST(
      makeRequest(
        { address: addressAt(HISTORY_IP_LIMIT), chainid: 1 },
        { "x-forwarded-for": "203.0.113.8" },
      ),
    );
    expect(otherIp.status).toBe(200);
  });

  it("rate-limits repeated requests for one address across IPs", async () => {
    for (let index = 0; index < HISTORY_ADDRESS_LIMIT; index += 1) {
      const response = await POST(
        makeRequest(
          { address: ADDRESS, chainid: 1 },
          { "x-forwarded-for": `198.51.100.${index + 1}` },
        ),
      );
      expect(response.status).toBe(200);
    }

    const blocked = await POST(
      makeRequest(
        { address: ADDRESS, chainid: 1 },
        { "x-forwarded-for": "198.51.100.200" },
      ),
    );
    expect(blocked.status).toBe(429);
  });
});
