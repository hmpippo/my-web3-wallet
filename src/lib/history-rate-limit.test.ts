import { describe, expect, it } from "vitest";
import { clientIp } from "./history-rate-limit";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/transactions", {
    method: "POST",
    headers,
  });
}

describe("clientIp", () => {
  it("takes the first valid address from x-forwarded-for", () => {
    expect(
      clientIp(requestWith({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })),
    ).toBe("203.0.113.7");
  });

  it("skips invalid forwarded entries", () => {
    expect(
      clientIp(requestWith({ "x-forwarded-for": "not-an-ip, 203.0.113.7" })),
    ).toBe("unknown");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(requestWith({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
  });

  it("shares one bucket when no address is available", () => {
    expect(clientIp(requestWith({}))).toBe("unknown");
  });
});
