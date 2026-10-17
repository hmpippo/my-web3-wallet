"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import type { NftStandard, StoredWalletNft } from "@/core/storage";
import { walletService } from "@/services/wallet-service";

interface NftPortfolioProps {
  nfts: readonly StoredWalletNft[];
}

export function NftPortfolio({ nfts }: NftPortfolioProps) {
  const [contractAddress, setContractAddress] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [standard, setStandard] = useState<NftStandard>("ERC-721");
  const [selectedNft, setSelectedNft] = useState<StoredWalletNft | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addNft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      const nft = await walletService.addNft(contractAddress, tokenId, standard);
      setContractAddress("");
      setTokenId("");
      setSelectedNft(nft);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load this NFT's metadata. Check the details and retry.",
      );
    } finally {
      setIsAdding(false);
    }
  }

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
          <p className="eyebrow">Sepolia assets</p>
          <h2 id="nfts-heading">NFTs</h2>
        </div>
      </div>

      <form className="nft-add-form" onSubmit={addNft}>
        <label htmlFor="nft-contract-address">Add an NFT</label>
        <div className="nft-add-controls">
          <input
            autoComplete="off"
            id="nft-contract-address"
            onChange={(event) => setContractAddress(event.target.value)}
            placeholder="NFT contract address"
            required
            spellCheck={false}
            value={contractAddress}
          />
          <input
            autoComplete="off"
            aria-label="NFT token ID"
            inputMode="numeric"
            onChange={(event) => setTokenId(event.target.value)}
            placeholder="Token ID"
            required
            value={tokenId}
          />
          <select
            aria-label="NFT standard"
            onChange={(event) => {
              if (
                event.target.value === "ERC-721" ||
                event.target.value === "ERC-1155"
              ) {
                setStandard(event.target.value);
              }
            }}
            value={standard}
          >
            <option value="ERC-721">ERC-721</option>
            <option value="ERC-1155">ERC-1155</option>
          </select>
          <button
            className="button button-primary"
            disabled={isAdding}
            type="submit"
          >
            {isAdding ? "Loading metadata..." : "Add NFT"}
          </button>
        </div>
        <p className="field-help">
          Metadata is read from the selected contract. Ownership is not checked;
          only public display details are saved locally.
        </p>
      </form>

      {error ? (
        <p className="form-error nft-error" role="alert">
          {error}
        </p>
      ) : null}

      {nfts.length === 0 ? (
        <p className="muted-copy token-empty">
          No NFTs added for this account yet. Add a contract, token ID, and
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
                  <code>{selectedNft.address}</code>
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
