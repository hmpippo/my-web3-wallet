"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import type { Address, Chain } from "viem";
import { CopyButton } from "@/components/copy-button";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

interface ReceiveAddressCardProps {
  /** Checksummed address of the currently selected account. */
  address: Address;
  chain: Chain;
  isTestnet: boolean;
}

/**
 * Presentational half of the receive screen, kept free of hooks so the encoded
 * QR payload and the full address can be asserted with a server-side render.
 *
 * The QR carries the bare `0x` address (no chain information), which is what
 * every scanner understands. The network is therefore stated in the copy around
 * it, so the address is never mistaken for one on another chain.
 */
export function ReceiveAddressCard({
  address,
  chain,
  isTestnet,
}: ReceiveAddressCardProps) {
  const symbol = chain.nativeCurrency.symbol;

  return (
    <section
      className="preview-card receive-card"
      aria-labelledby="receive-heading"
    >
      <h2 id="receive-heading">Your address</h2>
      <p className="muted-copy receive-intro">
        Scan this code or copy the address below to receive {symbol} or any
        ERC-20 token on {chain.name}
        {isTestnet ? " testnet" : ""}.
      </p>
      {/*
        The QR library packs modules edge to edge with no quiet zone, so the
        padding on this panel is what gives scanners the blank border they need.
        It stays white regardless of the surrounding theme.
      */}
      <div className="receive-qr" aria-hidden="true" data-qr-value={address}>
        <QRCode
          bgColor="#ffffff"
          fgColor="#17221d"
          level="M"
          size={232}
          value={address}
        />
      </div>
      <div className="receive-address-row">
        <code title={address}>{address}</code>
        <CopyButton label="your address" value={address} />
      </div>
      <p className="field-help receive-verify">
        Before sending, check that the scanned address matches this one
        character for character. Assets sent on another network cannot be
        recovered.
      </p>
    </section>
  );
}

export function ReceiveAddress() {
  const { chain, isTestnet } = useActiveChain();
  const walletState = useSyncExternalStore(
    walletService.subscribe,
    () => walletService.getState(),
    () => walletService.getState(),
  );
  const address = walletState.address;

  return (
    <main className="page-main">
      <section className="page-heading">
        <p className="eyebrow">
          {chain.name} {isTestnet ? "testnet" : "mainnet"}
        </p>
        <h1>Receive</h1>
        <p>
          Share this address to be paid on {chain.name}. It belongs to the
          selected account in this wallet.
        </p>
      </section>

      {address ? (
        <>
          <ReceiveAddressCard
            address={address}
            chain={chain}
            isTestnet={isTestnet}
          />
          <Link className="text-link back-link" href="/wallet">
            Back to wallet
          </Link>
        </>
      ) : (
        <p className="muted-copy" role="status">
          Loading your address...
        </p>
      )}
    </main>
  );
}
