import { describe, expect, it } from "vitest";
import {
  assessPassword,
  MIN_PASSWORD_LENGTH,
  passwordPolicyError,
} from "./password";

describe("password policy", () => {
  it("keeps the eight-character minimum", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(passwordPolicyError("1234567")).toBe("Use at least 8 characters.");
    expect(passwordPolicyError("12345678")).toBeNull();
  });

  it("caps absurdly long input", () => {
    expect(passwordPolicyError("a".repeat(1025))).toBe(
      "Use at most 1024 characters.",
    );
  });
});

describe("password strength estimate", () => {
  it("marks common and repetitive patterns weak", () => {
    expect(assessPassword("password").strength).toBe("weak");
    expect(assessPassword("qwertyuiop").strength).toBe("weak");
    expect(assessPassword("1234567890").strength).toBe("weak");
    expect(assessPassword("aaaaaaaa").strength).toBe("weak");
  });

  it("marks an eight-character multi-class password fair", () => {
    expect(assessPassword("Ab3!xy9z").strength).toBe("fair");
  });

  it("marks a long passphrase strong", () => {
    expect(assessPassword("correct horse battery staple").strength).toBe(
      "strong",
    );
    expect(assessPassword("aB3!aB3!aB3!aB3!").strength).toBe("strong");
  });

  it("treats an empty or whitespace-only password as weak", () => {
    expect(assessPassword("").strength).toBe("weak");
    expect(assessPassword("        ").strength).toBe("weak");
  });
});
