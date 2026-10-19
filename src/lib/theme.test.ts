import { describe, expect, it } from "vitest";
import { isThemeMode, resolveTheme } from "./theme";

describe("theme helpers", () => {
  it("accepts the three supported modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
  });

  it("rejects unknown or malformed values", () => {
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode("")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(1)).toBe(false);
  });

  it("follows the OS preference in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps an explicit mode regardless of the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
