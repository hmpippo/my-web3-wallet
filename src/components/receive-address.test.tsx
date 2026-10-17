import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sepolia } from "viem/chains";
import { ReceiveAddressCard } from "./receive-address";
import { truncateAddress } from "@/lib/address";

const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function render(address: string = ADDRESS, isTestnet = true) {
  return renderToStaticMarkup(
    createElement(ReceiveAddressCard, {
      address: address as `0x${string}`,
      chain: sepolia,
      isTestnet,
    }),
  );
}

/** Pulls the `<path>` geometry the QR encoder produced for the dark modules. */
function qrPaths(markup: string): string[] {
  return [...markup.matchAll(/<path[^>]*d="([^"]*)"/g)].map(
    (match) => match[1],
  );
}

describe("ReceiveAddressCard", () => {
  it("shows the full address so it can be compared with a scanned one", () => {
    const markup = render();

    expect(markup).toContain(ADDRESS);
    // The whole point of the row is verification, so it must not be shortened.
    expect(markup).not.toContain(truncateAddress(ADDRESS));
    expect(markup).toContain(`title="${ADDRESS}"`);
    expect(markup).toContain("Copy your address");
  });

  it("encodes the address into the QR code it renders", () => {
    const markup = render();

    expect(markup).toContain("<svg");
    expect(markup).toContain(`data-qr-value="${ADDRESS}"`);
    // The payload is not echoed as text by the encoder, so prove it reached the
    // matrix by rendering a different address and comparing the geometry.
    expect(qrPaths(markup).length).toBeGreaterThan(0);
    expect(qrPaths(render(OTHER_ADDRESS))).not.toEqual(qrPaths(markup));
  });

  it("names the network so the address is not used on the wrong chain", () => {
    expect(render(ADDRESS, true)).toContain("Sepolia testnet");
    expect(render(ADDRESS, false)).toContain(sepolia.name);
  });
});
