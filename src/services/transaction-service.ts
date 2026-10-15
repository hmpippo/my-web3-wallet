import { createWalletClient, getAddress, http, isAddress } from "viem";
import type { Address, Hex, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, publicClient } from "@/core/chain";

export interface NativeTransfer {
  to: Address;
  value: bigint;
  privateKey: Hex;
}

export async function sendNativeTransfer({
  to,
  value,
  privateKey,
}: NativeTransfer): Promise<Hash> {
  if (!isAddress(to)) {
    throw new TypeError("Recipient address is invalid");
  }
  if (value <= BigInt(0)) {
    throw new RangeError("Transfer value must be greater than zero");
  }

  const account = privateKeyToAccount(privateKey);
  const normalizedTo = getAddress(to);
  const [gas, gasPrice] = await Promise.all([
    publicClient.estimateGas({
      account: account.address,
      to: normalizedTo,
      value,
    }),
    publicClient.getGasPrice(),
  ]);

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
