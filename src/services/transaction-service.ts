import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
} from "viem";
import type { Address, Hex, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, publicClient } from "@/core/chain";

export interface NativeTransfer {
  to: Address;
  value: bigint;
  privateKey: Hex;
  gas?: bigint;
  gasPrice?: bigint;
}

export interface NativeTransferEstimate {
  gas: bigint;
  gasPrice: bigint;
  estimatedFee: bigint;
}

/** An ERC-20 estimate has the same shape as a native transfer estimate. */
export type Erc20TransferEstimate = NativeTransferEstimate;

export interface Erc20Transfer {
  token: Address;
  to: Address;
  amount: bigint;
  privateKey: Hex;
  gas?: bigint;
  gasPrice?: bigint;
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
}): Promise<NativeTransferEstimate> {
  const { from, value } = params;
  const to = validateRecipient(params.to);
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }

  const [gas, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: from, to, value }),
    publicClient.getGasPrice(),
  ]);
  return { gas, gasPrice, estimatedFee: gas * gasPrice };
}

export async function sendNativeTransfer({
  to,
  value,
  privateKey,
  gas: reviewedGas,
  gasPrice: reviewedGasPrice,
}: NativeTransfer): Promise<Hash> {
  const normalizedTo = validateRecipient(to);
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }

  const account = privateKeyToAccount(privateKey);
  const { gas, gasPrice } =
    reviewedGas !== undefined && reviewedGasPrice !== undefined
      ? { gas: reviewedGas, gasPrice: reviewedGasPrice }
      : await estimateNativeTransfer({
          from: account.address,
          to: normalizedTo,
          value,
        });

  const walletClient = createWalletClient({
    account,
    chain: CHAIN,
    transport: http(),
  });

  return walletClient.sendTransaction({
    account,
    to: normalizedTo,
    value,
    gas,
    gasPrice,
  });
}

export async function estimateErc20Transfer(params: {
  from: Address;
  token: Address;
  to: Address;
  amount: bigint;
}): Promise<Erc20TransferEstimate> {
  const { from, amount } = params;
  const token = validateToken(params.token);
  const to = validateRecipient(params.to);
  if (amount <= BigInt(0)) {
    throw new RangeError("Transfer amount must be greater than zero");
  }

  const data = encodeErc20Transfer(to, amount);
  const [gas, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: from, to: token, data }),
    publicClient.getGasPrice(),
  ]);
  return { gas, gasPrice, estimatedFee: gas * gasPrice };
}

export async function sendErc20Transfer({
  token,
  to,
  amount,
  privateKey,
  gas: reviewedGas,
  gasPrice: reviewedGasPrice,
}: Erc20Transfer): Promise<Hash> {
  const normalizedToken = validateToken(token);
  const normalizedTo = validateRecipient(to);
  if (amount <= BigInt(0)) {
    throw new RangeError("Transfer amount must be greater than zero");
  }

  const data = encodeErc20Transfer(normalizedTo, amount);
  const account = privateKeyToAccount(privateKey);
  const { gas, gasPrice } =
    reviewedGas !== undefined && reviewedGasPrice !== undefined
      ? { gas: reviewedGas, gasPrice: reviewedGasPrice }
      : await estimateErc20Transfer({
          from: account.address,
          token: normalizedToken,
          to: normalizedTo,
          amount,
        });

  const walletClient = createWalletClient({
    account,
    chain: CHAIN,
    transport: http(),
  });

  return walletClient.sendTransaction({
    account,
    to: normalizedToken,
    data,
    value: BigInt(0),
    gas,
    gasPrice,
  });
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
