import type { Address } from "viem";
import { getPublicClient } from "@/core/chain";
import { fixedError } from "@/lib/errors";

export async function getNativeBalance(
  address: Address,
  chainId: number,
): Promise<bigint> {
  try {
    return await getPublicClient(chainId).getBalance({ address });
  } catch (error) {
    throw fixedError(
      "Could not load the native balance. Check your connection and try again.",
      error,
    );
  }
}
