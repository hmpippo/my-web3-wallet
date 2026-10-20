import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
} from "viem";
import type { Address, Hex, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain, getPublicClient, getRpcUrl } from "@/core/chain";
import {
  NetworkFeeError,
  validateNetworkFee,
  type NetworkFee,
} from "@/core/fees";
import {
  errorNameInChain,
  INSUFFICIENT_FUNDS_MESSAGE,
  NETWORK_TIMEOUT_MESSAGE,
} from "@/lib/errors";

export interface NativeTransfer {
  to: Address;
  value: bigint;
  chainId: number;
  privateKey: Hex;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface NativeTransferEstimate extends NetworkFee {
  /** `gas * maxFeePerGas`; the most this transaction can cost. */
  maxTotalFee: bigint;
}

/** An ERC-20 estimate has the same shape as a native transfer estimate. */
export type Erc20TransferEstimate = NativeTransferEstimate;

export interface Erc20Transfer {
  token: Address;
  to: Address;
  amount: bigint;
  chainId: number;
  privateKey: Hex;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [validateRecipient(to), amount],
  });
}

export async function estimateNativeTransfer(params: {
  from: Address;
  to: Address;
  value: bigint;
  chainId: number;
}): Promise<NativeTransferEstimate> {
  const { from, value, chainId } = params;
  const to = validateRecipient(params.to);
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }

  const client = getPublicClient(chainId);
  let gas: bigint;
  let fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  try {
    [gas, fees] = await Promise.all([
      client.estimateGas({ account: from, to, value }),
      client.estimateFeesPerGas(),
    ]);
  } catch (error) {
    throw transferError(error, "native", "estimate");
  }

  return buildEstimate(gas, fees);
}

export async function sendNativeTransfer({
  to,
  value,
  chainId,
  privateKey,
  gas: reviewedGas,
  maxFeePerGas: reviewedMaxFeePerGas,
  maxPriorityFeePerGas: reviewedMaxPriorityFeePerGas,
}: NativeTransfer): Promise<Hash> {
  const normalizedTo = validateRecipient(to);
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }
  // Validate the reviewed snapshot before any network work, so a tampered or
  // stale review can never be signed even if it bypassed the UI checks.
  const reviewedFee = parseReviewedFee({
    gas: reviewedGas,
    maxFeePerGas: reviewedMaxFeePerGas,
    maxPriorityFeePerGas: reviewedMaxPriorityFeePerGas,
  });

  try {
    const account = privateKeyToAccount(privateKey);
    const fee =
      reviewedFee ??
      (await estimateNativeTransfer({
        from: account.address,
        to: normalizedTo,
        value,
        chainId,
      }));

    const walletClient = createWalletClient({
      account,
      chain: getChain(chainId),
      transport: http(getRpcUrl(chainId)),
    });

    return await walletClient.sendTransaction({
      account,
      to: normalizedTo,
      value,
      gas: fee.gas,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
    });
  } catch (error) {
    throw transferError(error, "native", "send");
  }
}

export async function estimateErc20Transfer(params: {
  from: Address;
  token: Address;
  to: Address;
  amount: bigint;
  chainId: number;
}): Promise<Erc20TransferEstimate> {
  const { from, amount, chainId } = params;
  const token = validateToken(params.token);
  const to = validateRecipient(params.to);
  if (amount <= BigInt(0)) {
    throw new RangeError("Transfer amount must be greater than zero");
  }

  const data = encodeErc20Transfer(to, amount);
  const client = getPublicClient(chainId);
  let gas: bigint;
  let fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  try {
    [gas, fees] = await Promise.all([
      client.estimateGas({ account: from, to: token, data }),
      client.estimateFeesPerGas(),
    ]);
  } catch (error) {
    throw transferError(error, "token", "estimate");
  }

  return buildEstimate(gas, fees);
}

export async function sendErc20Transfer({
  token,
  to,
  amount,
  chainId,
  privateKey,
  gas: reviewedGas,
  maxFeePerGas: reviewedMaxFeePerGas,
  maxPriorityFeePerGas: reviewedMaxPriorityFeePerGas,
}: Erc20Transfer): Promise<Hash> {
  const normalizedToken = validateToken(token);
  const normalizedTo = validateRecipient(to);
  if (amount <= BigInt(0)) {
    throw new RangeError("Transfer amount must be greater than zero");
  }

  const data = encodeErc20Transfer(normalizedTo, amount);
  const reviewedFee = parseReviewedFee({
    gas: reviewedGas,
    maxFeePerGas: reviewedMaxFeePerGas,
    maxPriorityFeePerGas: reviewedMaxPriorityFeePerGas,
  });
  try {
    const account = privateKeyToAccount(privateKey);
    const fee =
      reviewedFee ??
      (await estimateErc20Transfer({
        from: account.address,
        token: normalizedToken,
        to: normalizedTo,
        amount,
        chainId,
      }));

    const walletClient = createWalletClient({
      account,
      chain: getChain(chainId),
      transport: http(getRpcUrl(chainId)),
    });

    return await walletClient.sendTransaction({
      account,
      to: normalizedToken,
      data,
      value: BigInt(0),
      gas: fee.gas,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
    });
  } catch (error) {
    throw transferError(error, "token", "send");
  }
}

/**
 * Builds a validated EIP-1559 estimate. Runs outside the provider try/catch so
 * a policy failure surfaces with its own message instead of the generic
 * "could not estimate" text.
 */
function buildEstimate(
  gas: bigint,
  fees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint },
): NativeTransferEstimate {
  if (
    typeof fees.maxFeePerGas !== "bigint" ||
    typeof fees.maxPriorityFeePerGas !== "bigint"
  ) {
    throw new NetworkFeeError(
      "This network did not return EIP-1559 fees. Try again later.",
    );
  }
  const maxTotalFee = validateNetworkFee({
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  return {
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxTotalFee,
  };
}

/**
 * A reviewed fee must be complete: signing a partially reviewed transfer would
 * silently re-estimate some fields and sign fees the user never saw.
 */
function parseReviewedFee({
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
}: {
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}): NetworkFee | null {
  const anyProvided =
    gas !== undefined ||
    maxFeePerGas !== undefined ||
    maxPriorityFeePerGas !== undefined;
  if (!anyProvided) return null;
  if (
    gas === undefined ||
    maxFeePerGas === undefined ||
    maxPriorityFeePerGas === undefined
  ) {
    throw new NetworkFeeError(
      "The reviewed fee is incomplete. Estimate the transfer again.",
    );
  }
  validateNetworkFee({ gas, maxFeePerGas, maxPriorityFeePerGas });
  return { gas, maxFeePerGas, maxPriorityFeePerGas };
}

class TransferError extends Error {}

type TransferKind = "native" | "token";
type TransferAction = "estimate" | "send";

/**
 * Maps a provider/viem failure to fixed local text. Known conditions keep
 * actionable wording; everything else gets an operation-specific fallback.
 * The original error is retained as `cause` and never rendered.
 */
function transferError(
  error: unknown,
  kind: TransferKind,
  action: TransferAction,
): Error {
  if (error instanceof NetworkFeeError) return error;
  if (error instanceof TransferError) return error;

  if (errorNameInChain(error, ["InsufficientFundsError"])) {
    return new TransferError(INSUFFICIENT_FUNDS_MESSAGE, { cause: error });
  }
  if (errorNameInChain(error, ["TimeoutError", "HttpRequestError"])) {
    return new TransferError(NETWORK_TIMEOUT_MESSAGE, { cause: error });
  }
  if (errorNameInChain(error, ["Eip1559FeesNotSupportedError"])) {
    return new TransferError(
      "This network does not support EIP-1559 fees.",
      { cause: error },
    );
  }
  if (errorNameInChain(error, ["NonceTooLowError"])) {
    return new TransferError(
      "The account nonce changed before the transaction was sent. Refresh and try again.",
      { cause: error },
    );
  }
  if (errorNameInChain(error, ["ContractFunctionRevertedError"])) {
    return new TransferError(
      kind === "token"
        ? "The token contract rejected the transfer. Check the amount and token rules."
        : "The transaction was rejected by the contract.",
      { cause: error },
    );
  }

  const message =
    action === "estimate"
      ? kind === "token"
        ? "Could not estimate the token transfer fee. Check your connection and try again."
        : "Could not estimate the transfer fee. Check your connection and try again."
      : kind === "token"
        ? "The token transfer could not be sent. Check your connection and try again."
        : "The transaction could not be sent. Check your connection and try again.";
  return new TransferError(message, { cause: error });
}

function validateRecipient(address: Address): Address {
  if (!isAddress(address)) {
    throw new TypeError("Recipient address is invalid");
  }
  return getAddress(address);
}

function validateToken(address: Address): Address {
  if (!isAddress(address)) {
    throw new TypeError("Token contract address is invalid");
  }
  return getAddress(address);
}
