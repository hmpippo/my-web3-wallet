import { getAddress, isAddress, zeroAddress, type Address } from "viem";

/**
 * Parsed result of a recipient entered by hand, pasted, or read from a QR code.
 *
 * `amount` is always in the smallest unit of what is being sent: wei for a
 * native transfer, or the token's own base units when `token` is set. The caller
 * needs the token's decimals to turn it back into a decimal string.
 */
export interface ParsedRecipient {
  /** Checksummed recipient address. */
  address: Address;
  /** Network named by an EIP-681 link, already checked against the active chain. */
  chainId?: number;
  /** Requested amount in base units, when the input carries one. */
  amount?: bigint;
  /** ERC-20 contract the link asks to send, when it names one. */
  token?: Address;
}

const MAX_INPUT_LENGTH = 2048;
const MAX_UINT256 = BigInt(2) ** BigInt(256) - BigInt(1);
const ADDRESS_PATTERN = /^(?:0[xX])?[0-9a-fA-F]{40}$/;

/**
 * An input the wallet refuses to treat as a recipient. The message is written to
 * be shown to the user as-is; `sourceChainId` is present when the input is a
 * payment link for a network other than the active one, so the UI can name both
 * networks.
 */
export class RecipientInputError extends Error {
  readonly sourceChainId?: number;

  constructor(message: string, sourceChainId?: number) {
    super(message);
    this.name = "RecipientInputError";
    this.sourceChainId = sourceChainId;
  }
}

/**
 * Turns whatever a user typed, pasted, or scanned into a recipient.
 *
 * Accepted forms:
 * - bare `0x` address, or 40 hex characters without the prefix
 * - EIP-681 `ethereum:<address>[@<chainId>][/transfer][?...]` payment links
 *
 * Anything else (WalletConnect pairs, other chains' links, arbitrary text) is
 * rejected with an explanation instead of being coerced into an address.
 */
export function parseRecipientInput(
  raw: string,
  options: { chainId: number },
): ParsedRecipient {
  const input = raw.trim();
  if (!input) {
    throw new RecipientInputError("Enter or scan a wallet address.");
  }
  if (input.length > MAX_INPUT_LENGTH) {
    throw new RecipientInputError("That value is too long to be a wallet address.");
  }

  if (ADDRESS_PATTERN.test(input)) {
    return { address: validateAddress(input) };
  }

  if (/^ethereum:/i.test(input)) {
    return parseEthereumUri(input, options.chainId);
  }

  if (/^0[xX]/i.test(input)) {
    throw new RecipientInputError(
      "That doesn't look like a complete Ethereum address.",
    );
  }
  if (/^wc:/i.test(input)) {
    throw new RecipientInputError(
      "That's a WalletConnect pairing code, not a recipient address.",
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    throw new RecipientInputError(
      "Only Ethereum addresses and ethereum: payment links are supported.",
    );
  }

  throw new RecipientInputError("That doesn't look like an Ethereum address.");
}

/**
 * Parses an EIP-681 payment link. Two token shapes are understood:
 *
 * - `ethereum:<token>@<chain>/transfer?address=<recipient>&uint256=<amount>`
 * - `ethereum:<recipient>@<chain>/transfer?token=<token>&uint256=<amount>`
 *
 * Native transfers read `value` or `amount`. Numeric parameters follow EIP-681's
 * scientific notation (`2.5e18`) as well as plain base-unit integers, because
 * wallets in the wild emit both.
 */
function parseEthereumUri(
  input: string,
  activeChainId: number,
): ParsedRecipient {
  const body = input.slice("ethereum:".length);
  const queryIndex = body.indexOf("?");
  const main = queryIndex === -1 ? body : body.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : body.slice(queryIndex + 1);

  const slashIndex = main.indexOf("/");
  let target = slashIndex === -1 ? main : main.slice(0, slashIndex);
  const functionName =
    slashIndex === -1 ? "" : main.slice(slashIndex + 1).trim();

  let chainId: number | undefined;
  const atIndex = target.lastIndexOf("@");
  if (atIndex !== -1) {
    const chainPart = target.slice(atIndex + 1).trim();
    target = target.slice(0, atIndex);
    if (!/^\d+$/.test(chainPart)) {
      throw new RecipientInputError("That payment link has an invalid network id.");
    }
    const parsedChainId = Number(chainPart);
    if (!Number.isSafeInteger(parsedChainId) || parsedChainId <= 0) {
      throw new RecipientInputError("That payment link has an invalid network id.");
    }
    chainId = parsedChainId;
  }

  if (/^pay-/i.test(target)) target = target.slice(4);
  if (!target) {
    throw new RecipientInputError("That payment link doesn't include an address.");
  }
  if (functionName && functionName !== "transfer") {
    throw new RecipientInputError(
      "That payment link asks for a contract call this wallet can't make.",
    );
  }
  if (chainId !== undefined && chainId !== activeChainId) {
    throw new RecipientInputError(
      "This payment link is for a different network.",
      chainId,
    );
  }

  const parameters = new URLSearchParams(query);
  const recipientParameter = parameters.get("address");
  const tokenParameter = parameters.get("token");
  const amountParameter =
    parameters.get("value") ??
    parameters.get("uint256") ??
    parameters.get("amount");

  let address = validateAddress(target);
  let token: Address | undefined;

  if (recipientParameter !== null) {
    if (functionName !== "transfer") {
      throw new RecipientInputError(
        "That payment link is missing the transfer type.",
      );
    }
    // In the EIP-681 token form the main address is the token contract.
    token = address;
    address = validateAddress(recipientParameter);
  } else if (tokenParameter !== null) {
    token = validateAddress(tokenParameter);
  }

  const amount =
    amountParameter === null ? undefined : parseBaseUnits(amountParameter);

  return { address, chainId, amount, token };
}

/** Validates an address and returns it checksummed. */
function validateAddress(value: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new RecipientInputError(
      "That doesn't look like a complete Ethereum address.",
    );
  }
  // Accept an uppercase `0X` prefix and the bare 40-hex form some generators
  // emit; viem only understands the canonical `0x`.
  const normalized = /^0x/i.test(value) ? `0x${value.slice(2)}` : `0x${value}`;
  // viem's strict mode rejects a mixed-case address whose checksum is wrong,
  // which catches characters lost or changed while the code was shared.
  if (!isAddress(normalized, { strict: true })) {
    throw new RecipientInputError(
      "That Ethereum address fails its checksum check, so it may be mistyped or altered.",
    );
  }
  const address = getAddress(normalized);
  if (address === zeroAddress) {
    throw new RecipientInputError(
      "That address is the zero address, which would burn the funds.",
    );
  }
  return address;
}

/**
 * Reads an EIP-681 numeric parameter as an integer in base units. Scientific
 * notation is expanded exactly (no floating point) and the result must not have
 * a fractional part.
 */
function parseBaseUnits(raw: string): bigint {
  const value = raw.trim();
  const integerPattern = /^\d+$/;
  if (integerPattern.test(value)) {
    return checkAmount(BigInt(value));
  }

  const scientific = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(value);
  if (!scientific) {
    throw new RecipientInputError(
      "That payment link has an amount the wallet can't read.",
    );
  }

  const whole = scientific[1];
  const fraction = scientific[2] ?? "";
  const exponent = Number(scientific[3]);
  if (!Number.isSafeInteger(exponent) || exponent > 30) {
    throw new RecipientInputError(
      "That payment link has an amount the wallet can't read.",
    );
  }
  if (exponent < fraction.length) {
    throw new RecipientInputError(
      "That payment link has an amount the wallet can't read.",
    );
  }

  const digits = `${whole}${fraction}`;
  return checkAmount(
    BigInt(digits) * BigInt(10) ** BigInt(exponent - fraction.length),
  );
}

function checkAmount(amount: bigint): bigint {
  if (amount > MAX_UINT256) {
    throw new RecipientInputError(
      "That payment link has an amount larger than the network supports.",
    );
  }
  return amount;
}
