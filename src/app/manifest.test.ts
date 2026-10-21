import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  it("declares an installable standalone app with the required icons", () => {
    const value = manifest();

    expect(value.name).toBe("My Wallet");
    expect(value.short_name).toBe("Wallet");
    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    expect(value.background_color).toBe("#0b1310");
    expect(value.theme_color).toBe("#0b1310");
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });
});
