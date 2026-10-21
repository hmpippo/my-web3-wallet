import { describe, expect, it } from "vitest";
import {
  parseRecipientInput,
  RecipientInputError,
} from "./recipient-input";

const RECIPIENT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RECIPIENT_LOWER = RECIPIENT.toLowerCase();
const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SEPOLIA = 11155111;
const MAINNET = 1;

function expectError(input: string, message: RegExp, chainId = SEPOLIA) {
  try {
    parseRecipientInput(input, { chainId });
  } catch (caught) {
    expect(caught).toBeInstanceOf(RecipientInputError);
    expect((caught as Error).message).toMatch(message);
    return caught as RecipientInputError;
  }
  throw new Error(`Expected ${input} to be rejected`);
}

describe("parseRecipientInput", () => {
  it("accepts a bare lowercase address and returns it checksummed", () => {
    expect(parseRecipientInput(RECIPIENT_LOWER, { chainId: SEPOLIA })).toEqual({
      address: RECIPIENT,
    });
  });

  it("accepts an already checksummed address and surrounding whitespace", () => {
    expect(
      parseRecipientInput(`\n  ${RECIPIENT}\t`, { chainId: SEPOLIA }),
    ).toEqual({ address: RECIPIENT });
  });

  it("accepts an address without the 0x prefix", () => {
    expect(
      parseRecipientInput(RECIPIENT.slice(2), { chainId: SEPOLIA }),
    ).toEqual({ address: RECIPIENT });
  });

  it("rejects an address with a broken checksum", () => {
    expectError(
      `0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266`,
      /checksum/,
    );
  });

  it("rejects an address of the wrong length", () => {
    expectError("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226", /complete Ethereum address/);
  });

  it("rejects the zero address", () => {
    expectError(`0x${"0".repeat(40)}`, /burn/);
  });

  it("rejects empty input", () => {
    expectError("   ", /wallet address/);
  });

  it("rejects WalletConnect pairs", () => {
    expectError("wc:1234@2?relay-protocol=irn", /WalletConnect/);
  });

  it("rejects links for other chains", () => {
    expectError("bitcoin:bc1qexample", /Only Ethereum addresses/);
  });

  it("rejects oversized input", () => {
    expectError(`0x${"a".repeat(3000)}`, /too long/);
  });

  it("reads an EIP-681 native transfer with value in wei", () => {
    expect(
      parseRecipientInput(
        `ethereum:${RECIPIENT}@${SEPOLIA}/transfer?value=1000000000000000000`,
        { chainId: SEPOLIA },
      ),
    ).toEqual({
      address: RECIPIENT,
      chainId: SEPOLIA,
      amount: BigInt("1000000000000000000"),
    });
  });

  it("expands scientific notation without floating point", () => {
    const parsed = parseRecipientInput(
      `ethereum:${RECIPIENT}?value=1.5e18`,
      { chainId: SEPOLIA },
    );
    expect(parsed.amount).toBe(BigInt("1500000000000000000"));
  });

  it("accepts the pay- prefix and a missing network id", () => {
    expect(
      parseRecipientInput(`ethereum:pay-${RECIPIENT}?value=42`, {
        chainId: SEPOLIA,
      }),
    ).toEqual({ address: RECIPIENT, amount: BigInt("42") });
  });

  it("rejects a network id that does not match the active chain", () => {
    const error = expectError(
      `ethereum:${RECIPIENT}@${MAINNET}`,
      /different network/,
      SEPOLIA,
    );
    expect(error.sourceChainId).toBe(MAINNET);
  });

  it("reads the EIP-681 token form where the target is the token contract", () => {
    expect(
      parseRecipientInput(
        `ethereum:${TOKEN}@${MAINNET}/transfer?address=${RECIPIENT}&uint256=2500000`,
        { chainId: MAINNET },
      ),
    ).toEqual({
      address: RECIPIENT,
      chainId: MAINNET,
      amount: BigInt("2500000"),
      token: TOKEN,
    });
  });

  it("reads a token parameter on a recipient-addressed link", () => {
    expect(
      parseRecipientInput(
        `ethereum:${RECIPIENT}@${MAINNET}?token=${TOKEN}&value=2.5e6`,
        { chainId: MAINNET },
      ),
    ).toEqual({
      address: RECIPIENT,
      chainId: MAINNET,
      amount: BigInt("2500000"),
      token: TOKEN,
    });
  });

  it("rejects contract calls that are not transfers", () => {
    expectError(
      `ethereum:${TOKEN}@${MAINNET}/approve?address=${RECIPIENT}&uint256=1`,
      /can't make/,
      MAINNET,
    );
  });

  it("rejects an amount with a fractional base unit", () => {
    expectError(`ethereum:${RECIPIENT}?value=1e-3`, /amount the wallet can't read/);
  });

  it("rejects an amount beyond uint256", () => {
    expectError(`ethereum:${RECIPIENT}?value=1e31`, /amount the wallet can't read/);
  });
});
