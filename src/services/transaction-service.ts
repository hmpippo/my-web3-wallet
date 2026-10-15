import {
  createWalletClient,
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
}

export interface NativeTransferEstimate {
  gas: bigint;
  gasPrice: bigint;
  estimatedFee: bigint;
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
}: NativeTransfer): Promise<Hash> {
  const normalizedTo = validateRecipient(to);
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }

  const account = privateKeyToAccount(privateKey);
  const { gas, gasPrice } = await estimateNativeTransfer({
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

function validateRecipient(address: Address): Address {
  if (!isAddress(address)) {
    throw new TypeError("Recipient address is invalid");
  }
  return getAddress(address);
}
