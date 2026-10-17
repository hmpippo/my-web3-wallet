"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useActiveChain } from "@/lib/use-active-chain";
import { walletService } from "@/services/wallet-service";

/** Imports an ERC-20 token by contract address into the selected account. */
export function ImportTokenForm() {
  const router = useRouter();
  const { chainId, chain } = useActiveChain();
  const [contractAddress, setContractAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsAdding(true);
    try {
      await walletService.addToken(contractAddress, chainId);
      setContractAddress("");
      router.push("/tokens");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not add this token contract.",
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
          <h1>Import token</h1>
        </div>
        <Link className="button button-outline" href="/tokens">
          Back
        </Link>
      </section>

      <section className="preview-card">
        <form className="token-add-form" onSubmit={addToken}>
          <label htmlFor="token-contract-address">ERC-20 contract address</label>
          <div className="token-add-controls">
            <input
              autoComplete="off"
              id="token-contract-address"
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="Token contract address"
              required
              spellCheck={false}
              value={contractAddress}
            />
            <button
              className="button button-primary"
              disabled={isAdding}
              type="submit"
            >
              {isAdding ? "Checking..." : "Import token"}
            </button>
          </div>
          <p className="field-help">
            Token name, symbol, and decimals are verified from the {chain.name}{" "}
            contract.
          </p>
        </form>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
