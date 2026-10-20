import { describe, expect, it } from "vitest";
import { errorNameInChain, fixedError } from "./errors";

function named(name: string, message = "upstream detail"): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("errorNameInChain", () => {
  it("matches the top-level error name", () => {
    expect(errorNameInChain(named("InsufficientFundsError"), ["InsufficientFundsError"])).toBe(true);
    expect(errorNameInChain(named("OtherError"), ["InsufficientFundsError"])).toBe(false);
  });

  it("matches a nested cause", () => {
    const inner = named("ContractFunctionRevertedError");
    const outer = new Error("execution failed", { cause: inner });

    expect(
      errorNameInChain(outer, ["ContractFunctionRevertedError"]),
    ).toBe(true);
  });

  it("stops after a bounded depth and tolerates non-errors", () => {
    let current: unknown = named("DeepError");
    for (let depth = 0; depth < 6; depth += 1) {
      current = new Error("wrapper", { cause: current });
    }

    expect(errorNameInChain(current, ["DeepError"])).toBe(false);
    expect(errorNameInChain("not an error", ["Error"])).toBe(false);
    expect(errorNameInChain(null, ["Error"])).toBe(false);
  });
});

describe("fixedError", () => {
  it("keeps the original error as the cause", () => {
    const cause = new Error("untrusted text");
    const error = fixedError("Safe message", cause);

    expect(error.message).toBe("Safe message");
    expect(error.cause).toBe(cause);
  });
});
