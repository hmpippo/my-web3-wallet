"use client";

import Image from "next/image";
import { useState } from "react";
import { getWalletChain } from "@/core/chain";
import type { StoredWalletNft } from "@/core/storage";
import { walletService } from "@/services/wallet-service";
import { CopyButton } from "@/components/copy-button";
import { OverflowMenu } from "@/components/overflow-menu";

interface NftPortfolioProps {
  chainId: number;
  nfts: readonly StoredWalletNft[];
}

export function NftPortfolio({ chainId, nfts }: NftPortfolioProps) {
  const { chain } = getWalletChain(chainId);
  const [selectedNft, setSelectedNft] = useState<StoredWalletNft | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeNft(nft: StoredWalletNft) {
    const key = nftKey(nft);
    if (
      !window.confirm(
        "Remove this NFT from this account's local list? This does not transfer or destroy the on-chain NFT.",
      )
    ) {
      return;
    }
    setError(null);
    setRemovingKey(key);
    try {
      await walletService.removeNft(
        nft.address,
        nft.tokenId,
        nft.standard,
        chainId,
      );
      if (selectedNft && nftKey(selectedNft) === key) setSelectedNft(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove this NFT from the local list.",
      );
    } finally {
      setRemovingKey(null);
    }
  }

  return (
    <section className="history-card nft-card" aria-labelledby="nfts-heading">
      <div className="history-heading">
        <div>
          <p className="eyebrow">{chain.name} assets</p>
          <h2 id="nfts-heading">NFTs</h2>
        </div>
        <OverflowMenu
          label="NFT list options"
          items={[
            {
              label: "Refresh list",
              onClick: () => void walletService.syncNftOwnership(chainId),
            },
            { label: "Import NFT", href: "/nfts/import" },
          ]}
        />
      </div>

      {error ? (
        <p className="form-error nft-error" role="alert">
          {error}
        </p>
      ) : null}

      {nfts.length === 0 ? (
        <p className="muted-copy token-empty">
          No NFTs added for this account yet. Import a contract, token ID, and
          standard to load its metadata.
        </p>
      ) : (
        <ul className="nft-grid" aria-label="NFTs for this account">
          {nfts.map((nft) => {
            const key = nftKey(nft);
            return (
              <li className="nft-grid-item" key={key}>
                <button
                  aria-label={`View ${nft.name}`}
                  className="nft-tile"
                  onClick={() => setSelectedNft(nft)}
                  type="button"
                >
                  {nft.imageUrl ? (
                    <Image
                      alt=""
                      className="nft-thumbnail"
                      height={220}
                      src={nft.imageUrl}
                      unoptimized
                      width={220}
                    />
                  ) : (
                    <span className="nft-placeholder" aria-hidden="true">
                      NFT
                    </span>
                  )}
                  <span className="nft-tile-name">{nft.name}</span>
                  <span className="nft-tile-standard">
                    {nft.standard} · #{nft.tokenId}
                  </span>
                </button>
                <button
                  aria-label={`Remove ${nft.name}`}
                  className="nft-remove"
                  disabled={removingKey === key}
                  onClick={() => void removeNft(nft)}
                  type="button"
                >
                  {removingKey === key ? "Removing..." : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedNft ? (
        <div
          className="nft-detail-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedNft(null);
          }}
        >
          <section
            aria-labelledby="nft-detail-heading"
            aria-modal="true"
            className="nft-detail"
            role="dialog"
          >
            <button
              aria-label="Close NFT details"
              className="nft-detail-close"
              onClick={() => setSelectedNft(null)}
              type="button"
            >
              Close
            </button>
            {selectedNft.imageUrl ? (
              <Image
                alt={selectedNft.name}
                className="nft-detail-image"
                height={720}
                src={selectedNft.imageUrl}
                unoptimized
                width={720}
              />
            ) : null}
            <h3 id="nft-detail-heading">{selectedNft.name}</h3>
            <p className="nft-detail-description">
              {selectedNft.description || "No description provided."}
            </p>
            <dl className="nft-detail-fields">
              <div>
                <dt>Contract</dt>
                <dd>
                  <span className="address-line">
                    <code>{selectedNft.address}</code>
                    <CopyButton
                      label="NFT contract address"
                      value={selectedNft.address}
                    />
                  </span>
                </dd>
              </div>
              <div>
                <dt>Token ID</dt>
                <dd>{selectedNft.tokenId}</dd>
              </div>
              <div>
                <dt>Standard</dt>
                <dd>{selectedNft.standard}</dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function nftKey(nft: StoredWalletNft): string {
  return `${nft.address.toLowerCase()}:${nft.tokenId}:${nft.standard}`;
}
