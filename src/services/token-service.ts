import {
  formatUnits,
  getAddress,
  isAddress,
  type Address,
} from "viem";
import { publicClient } from "@/core/chain";
import type { StoredWalletToken } from "@/core/storage";

const erc20ReadAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export function normalizeTokenAddress(value: string): Address {
  if (!isAddress(value.trim())) {
    throw new Error("Enter a valid ERC-20 contract address.");
  }
  return getAddress(value.trim());
}

export async function readTokenMetadata(
  address: Address,
): Promise<Omit<StoredWalletToken, "hidden">> {
  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address,
        abi: erc20ReadAbi,
        functionName: "name",
      }),
      publicClient.readContract({
        address,
        abi: erc20ReadAbi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address,
        abi: erc20ReadAbi,
        functionName: "decimals",
      }),
    ]);

    if (
      name.trim().length === 0 ||
      name.length > 128 ||
      symbol.trim().length === 0 ||
      symbol.length > 32 ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 255
    ) {
      throw new Error("The contract returned invalid token metadata.");
    }

    return { address, name: name.trim(), symbol: symbol.trim(), decimals };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The contract returned invalid token metadata."
    ) {
      throw error;
    }
    throw new Error(
      "Could not read ERC-20 name, symbol, and decimals from this contract.",
      { cause: error },
    );
  }
}

export async function getTokenBalance(
  token: Pick<StoredWalletToken, "address" | "decimals" | "symbol">,
  account: Address,
): Promise<{ raw: bigint; formatted: string }> {
  try {
    const raw = await publicClient.readContract({
      address: token.address,
      abi: erc20ReadAbi,
      functionName: "balanceOf",
      args: [account],
    });
    return { raw, formatted: formatUnits(raw, token.decimals) };
  } catch (error) {
    throw new Error(`Could not load the ${token.symbol} token balance.`, {
      cause: error,
    });
  }
}
