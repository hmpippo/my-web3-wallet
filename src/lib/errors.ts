/**
 * Helpers for converting untrusted provider failures into fixed, local text.
 *
 * Wallets talk to RPC endpoints, contracts, and gateways that can return
 * arbitrary strings. Those strings must never be rendered: a provider error is
 * an untrusted input, and a convincing message is a phishing surface. Service
 * boundaries wrap the original error as `cause` (for debugging and tests) and
 * throw a message from this module instead.
 */
const MAX_CAUSE_DEPTH = 5;

export const INSUFFICIENT_FUNDS_MESSAGE =
  "This account does not have enough ETH to cover the transfer and network fee.";

export const NETWORK_TIMEOUT_MESSAGE =
  "The network request timed out. Check your connection and try again.";

/**
 * True when `error` or one of its `cause` links has one of the given error
 * names. viem nests the useful error (for example
 * `ContractFunctionRevertedError`) inside a generic execution error, so
 * checking only the top-level name misses the actual condition.
 */
export function errorNameInChain(
  error: unknown,
  names: readonly string[],
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) return false;
    if (names.includes(current.name)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Creates an error whose message is safe to display, keeping the original. */
export function fixedError(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}
