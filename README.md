# My Wallet

A client-side, non-custodial EVM wallet MVP. The app includes wallet setup,
import, unlock, balance, native-transfer, and paginated transaction-history
flows for Sepolia testnet.

## Development

This project uses Next.js App Router, TypeScript, Tailwind CSS, and pnpm.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Project structure

- `src/app/` — entry, wallet preview, and send preview routes
- `src/components/` — shared presentational UI
- `src/core/hd-wallet.ts` — BIP-39 mnemonics and BIP-32 account derivation
- `src/core/crypto.ts` — PBKDF2 (600,000 iterations) and AES-GCM vault encryption
- `src/core/storage.ts` — encrypted vault and public account metadata storage
- `src/core/chain.ts` — Sepolia chain and viem public client
- `src/services/wallet-service.ts` — create, import, unlock, lock, and send lifecycle
- `src/services/transaction-service.ts` — estimated-gas native transfers with viem
- `src/services/balance-service.ts` — native Sepolia balance reads
- `src/services/token-service.ts` — ERC-20 metadata and balance reads from Sepolia RPC
- `src/services/nft-service.ts` — ERC-721/ERC-1155 metadata URI and public metadata reads
- `src/services/etherscan-history.ts` — server-only Etherscan V2 activity adapter
- `src/app/api/transactions/route.ts` — validated same-origin history endpoint
- `src/store/`, `src/types/`, `src/lib/` — reserved for follow-up state and shared utilities

Wallet creation displays a recovery phrase before asking the user to confirm
its backup and set a password. The vault is not persisted before confirmation.
Import and unlock are local operations. Locking clears the service's in-memory
derived keys and account state, including on page unload. Native transfers
show an estimated fee before confirmation. The browser UI is still a
self-custody wallet MVP: use Sepolia testnet only, and never enter a recovery
phrase used for real funds.

The wallet derives Ethereum accounts from `m/44'/60'/0'/0/{index}`. Account 1
uses index 0 to preserve the default address; add later accounts on demand
from the wallet dashboard. All accounts derived from the same recovery phrase
are grouped under the same wallet. Their derivation paths, editable names,
visibility, and last selected account are persisted as public metadata in
`wallet_accounts_v1`, separately from the encrypted mnemonic vault. No seed or
private key is stored there. Locking clears derived keys from memory; after
unlocking, the wallet restores the saved accounts and selected visible account.
Accounts can be hidden and restored without deleting them or their funds, and
new accounts always use the next unused derivation index.

The wallet overview includes a Tokens tab for manually added Sepolia ERC-20
contracts. Token name, symbol, decimals, and the selected account's current
balance are read directly from the contract through the configured RPC.
Contract metadata and hidden/visible state are stored per account; balances are
refreshed from chain and are never persisted. Zero-balance tokens remain listed.
Hide a token to remove it from the portfolio list, then restore it from token
management. This is not automatic token discovery: only contracts added by the
user are shown.

The NFTs tab lets the user add a contract, token ID, and ERC-721/ERC-1155
standard to the selected account's local list. The wallet reads `tokenURI` or
`uri` from Sepolia and loads the returned metadata: inline `data:` JSON is
decoded in place, `ipfs://` is resolved through `https://ipfs.io`, `ar://`
through `https://arweave.net`, and HTTPS URLs (including scheme-less `host/path`
values that some contracts return) are fetched directly. Metadata and image
links are untrusted public content; only public HTTPS and inline images are
used, loopback/private hosts are refused, metadata responses are capped at
256 KiB, and descriptions are rendered as text. A broken or oversized `image`
field only drops the picture, never the NFT entry. NFT records are public
display metadata stored per account, and ownership is verified on chain: adding
an entry calls `ownerOf` (ERC-721) or `balanceOf` (ERC-1155) and refuses tokens
the selected account does not hold, so a token that fails ownership cannot be
listed. The check is repeated whenever a wallet session starts, the account
changes, or the NFT list is opened, which removes entries the account no longer
owns after a transfer. Only a definitive "not owned" answer deletes an entry: a
reverting `ownerOf` (for example a burned token) or an unreachable RPC keeps the
entry, so a network hiccup can never silently wipe the list. The wallet still
never discovers NFTs automatically. Removing an entry only removes it from the
local list and has no on-chain effect. Metadata fetch, CORS, gateway, or
ownership-read errors are surfaced so the user can retry.

## Transaction history

The wallet dashboard has separate tabs for normal ETH transactions, internal
ETH transfers, and ERC-20 token transfers from Etherscan API V2 on Sepolia.
Each tab loads and paginates only its own Etherscan source without exposing the
API key to browser code. NFT activity and token holdings are not included.
The server pins the current Sepolia block height into the signed pagination
cursor, so new blocks do not shift the upstream offset pages mid-session.

Set `ETHERSCAN_API_KEY` in the repository's ignored `.env` file for local
development, and provide the same server-only environment variable in
deployment. Do not prefix it with `NEXT_PUBLIC_`. Only the public wallet address
and the selected activity kind and signed continuation cursor are sent to the
app's history route; wallet mnemonics and private keys are never sent. The
server route requires a running Next.js server and does not work as a static
export.

The free Etherscan tier lists Sepolia as supported and allows up to 3 API calls
per second and 100,000 calls per day. A history page requests one page from its
selected activity source; provider limits or outages are shown as retryable
errors. NFT transaction history, token holdings, and automatic asset discovery
are not included.
If the server cannot reach Etherscan directly, enable Node's environment proxy
support when starting the dev server, for example:

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 pnpm dev
```

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
