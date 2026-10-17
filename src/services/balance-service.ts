import type { Address } from "viem";
import { getPublicClient } from "@/core/chain";

export async function getNativeBalance(
  address: Address,
  chainId: number,
): Promise<bigint> {
  return getPublicClient(chainId).getBalance({ address });
}
