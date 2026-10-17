"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { NftStandard } from "@/core/storage";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

/** Imports an NFT (contract + token ID) into the selected account. */
export function ImportNftForm() {
  const router = useRouter();
  const { chainId, chain } = useActiveChain();
  const [contractAddress, setContractAddress] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [standard, setStandard] = useState<NftStandard>("ERC-721");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      await walletService.addNft(contractAddress, tokenId, standard, chainId);
      setContractAddress("");
      setTokenId("");
      router.push("/wallet?tab=nfts");
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

  return (
    <main className="page-main form-page">
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">{chain.name} assets</p>
          <h1>Import NFT</h1>
        </div>
        <Link className="button button-outline" href="/wallet?tab=nfts">
          Back
        </Link>
      </section>

      <section className="preview-card">
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
              {isAdding ? "Loading metadata..." : "Import NFT"}
            </button>
          </div>
          <p className="field-help">
            Metadata is read from the selected contract and ownership is
            verified on chain for the selected account before anything is saved.
            Entries this account no longer owns are removed automatically when
            the list is opened.
          </p>
        </form>

        {error ? (
          <p className="form-error nft-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
