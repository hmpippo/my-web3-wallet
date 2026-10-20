import { createWalletClient, getAddress, http, zeroAddress } from "viem";
import type { Address, Hash, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain, getPublicClient, getRpcUrl } from "@/core/chain";
import {
  errorNameInChain,
  fixedError,
  INSUFFICIENT_FUNDS_MESSAGE,
  NETWORK_TIMEOUT_MESSAGE,
} from "@/lib/errors";

/**
 * The EIP-7702 delegation designator prefix.
 *
 * A delegated account's code reads `0xef0100 || <delegate address>`. Any other
 * code value is either plain (empty) or a regular contract this wallet does not
 * treat as a delegation.
 */
const DELEGATION_PREFIX = "0xef0100";

/**
 * Extracts the delegate address from an account's code.
 *
 * Pure and side-effect free so the 7702 encoding can be asserted without a
 * network. Returns `null` when the code is empty or is not a well-formed
 * delegation indicator, so a non-delegation contract never masquerades as one.
 */
export function parseDelegation(code: Hex | undefined): Address | null {
  if (!code || code === "0x") return null;
  if (!code.startsWith(DELEGATION_PREFIX)) return null;
  const delegate = code.slice(DELEGATION_PREFIX.length);
  if (!/^[0-9a-fA-F]{40}$/.test(delegate)) return null;
  return getAddress(`0x${delegate.toLowerCase()}`);
}

/** Reads the EIP-7702 delegate set on an account, or `null` when it has none. */
export async function readDelegatedAddress(
  address: Address,
  chainId: number,
): Promise<Address | null> {
  try {
    const code = await getPublicClient(chainId).getCode({ address });
    return parseDelegation(code);
  } catch (error) {
    throw fixedError(
      "Could not read the account delegation. Check the network and try again.",
      error,
    );
  }
}

export interface RevokeDelegation {
  address: Address;
  chainId: number;
  privateKey: Hex;
}

/**
 * Revokes an account's EIP-7702 delegation.
 *
 * Signing an authorization to the zero address makes the network clear the
 * account's code, which is how a delegation is removed. The account also sends
 * the type-4 transaction itself (`executor: 'self'`), so it pays the gas.
 */
export async function revokeDelegation({
  address,
  chainId,
  privateKey,
}: RevokeDelegation): Promise<Hash> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: getChain(chainId),
    transport: http(getRpcUrl(chainId)),
  });

  try {
    const authorization = await walletClient.signAuthorization({
      account,
      contractAddress: zeroAddress,
      executor: "self",
    });

    return await walletClient.sendTransaction({
      account,
      authorizationList: [authorization],
      to: address,
      data: "0x",
      value: BigInt(0),
    });
  } catch (error) {
    if (errorNameInChain(error, ["InsufficientFundsError"])) {
      throw fixedError(INSUFFICIENT_FUNDS_MESSAGE, error);
    }
    if (errorNameInChain(error, ["TimeoutError", "HttpRequestError"])) {
      throw fixedError(NETWORK_TIMEOUT_MESSAGE, error);
    }
    throw fixedError(
      "Could not revoke the delegation. Check the network and try again.",
      error,
    );
  }
}
