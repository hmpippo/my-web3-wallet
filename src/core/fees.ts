/**
 * EIP-1559 fee policy for user-signed transfers.
 *
 * The RPC proposes the base fee and priority fee, but it is an untrusted input:
 * a malicious or compromised endpoint can propose an extreme price. These
 * ceilings bound what the wallet will ever sign. A transaction that exceeds a
 * ceiling is refused rather than silently reduced, so the user never signs
 * different numbers than the review screen showed.
 *
 * Values are in wei. The total ceiling is denominated in the chain's native
 * currency (ETH on every chain this wallet supports except Polygon's POL).
 */
export const MAX_GAS_LIMIT = BigInt(1_000_000);

/** 1,000 gwei. */
export const MAX_FEE_PER_GAS = BigInt(1_000_000_000_000);

/** 50 gwei. */
export const MAX_PRIORITY_FEE_PER_GAS = BigInt(50_000_000_000);

/** 0.1 native token. */
export const MAX_TOTAL_FEE = BigInt(100_000_000_000_000_000);

/** Warn (but still allow) at 100 gwei. */
export const HIGH_FEE_PER_GAS = BigInt(100_000_000_000);

/** Warn (but still allow) at 0.01 native token. */
export const HIGH_TOTAL_FEE = BigInt(10_000_000_000_000_000);

/** A locally generated fee-policy failure. Never contains provider text. */
export class NetworkFeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkFeeError";
  }
}

export interface NetworkFee {
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * Validates a transfer fee against the hard ceilings and returns the maximum
 * total the user can pay.
 */
export function validateNetworkFee({
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
}: NetworkFee): bigint {
  if (typeof gas !== "bigint" || gas <= BigInt(0)) {
    throw new NetworkFeeError(
      "The estimated gas limit is invalid. Estimate the transfer again.",
    );
  }
  if (gas > MAX_GAS_LIMIT) {
    throw new NetworkFeeError(
      "The estimated gas limit is unusually high. Try again later.",
    );
  }
  if (typeof maxFeePerGas !== "bigint" || maxFeePerGas <= BigInt(0)) {
    throw new NetworkFeeError(
      "The proposed maximum fee per gas is invalid. Try again later.",
    );
  }
  if (maxFeePerGas > MAX_FEE_PER_GAS) {
    throw new NetworkFeeError(
      "The proposed maximum fee per gas is unusually high. Try again later.",
    );
  }
  // Some L2s legitimately return a zero priority fee.
  if (
    typeof maxPriorityFeePerGas !== "bigint" ||
    maxPriorityFeePerGas < BigInt(0)
  ) {
    throw new NetworkFeeError(
      "The proposed priority fee is invalid. Try again later.",
    );
  }
  if (maxPriorityFeePerGas > MAX_PRIORITY_FEE_PER_GAS) {
    throw new NetworkFeeError(
      "The proposed priority fee is unusually high. Try again later.",
    );
  }
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new NetworkFeeError(
      "The priority fee cannot exceed the maximum fee per gas.",
    );
  }

  const maxTotalFee = gas * maxFeePerGas;
  if (maxTotalFee > MAX_TOTAL_FEE) {
    throw new NetworkFeeError(
      "The maximum network fee is unusually high. Try again later.",
    );
  }
  return maxTotalFee;
}

/** True when a valid fee is high enough to deserve a prominent warning. */
export function isUnusuallyHighFee({
  maxFeePerGas,
  maxTotalFee,
}: {
  maxFeePerGas: bigint;
  maxTotalFee: bigint;
}): boolean {
  return maxFeePerGas >= HIGH_FEE_PER_GAS || maxTotalFee >= HIGH_TOTAL_FEE;
}
