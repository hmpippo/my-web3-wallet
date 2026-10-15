import type { Address } from "viem";
import { publicClient } from "@/core/chain";

export async function getNativeBalance(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}
