import { describe, expect, it } from "vitest";
import { truncateAddress } from "./address";

describe("truncateAddress", () => {
  it("keeps the prefix and suffix of a full address", () => {
    expect(truncateAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(
      "0xf39F…2266",
    );
  });

  it("returns short values unchanged", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});
