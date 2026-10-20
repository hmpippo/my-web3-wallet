# My Wallet

[![Lint](https://github.com/hmpippo/my-web3-wallet/actions/workflows/lint.yml/badge.svg)](https://github.com/hmpippo/my-web3-wallet/actions/workflows/lint.yml)
[![Test](https://github.com/hmpippo/my-web3-wallet/actions/workflows/test.yml/badge.svg)](https://github.com/hmpippo/my-web3-wallet/actions/workflows/test.yml)

A client-side, non-custodial EVM wallet MVP. The app includes wallet setup,
import, unlock, balance, native-transfer, and paginated transaction-history
flows across multiple EVM networks.

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
- `src/core/private-key.ts` — private-key normalization and address derivation for imports
- `src/core/vault-secret.ts` — the tagged vault secret (recovery phrase or private key) and its legacy readback
- `src/core/crypto.ts` — PBKDF2 (600,000 iterations) and AES-GCM vault encryption
- `src/core/webauthn.ts` — WebAuthn passkey creation and PRF evaluation for biometric unlock
- `src/core/biometric-vault.ts` — HKDF and AES-GCM wrapping of the recovery phrase under a passkey
- `src/core/storage.ts` — encrypted vault, biometric unlock vault, and public account metadata storage
- `src/core/chain.ts` — supported-chain registry, per-chain RPC resolution, and cached viem public clients
- `src/core/fees.ts` — EIP-1559 fee validation, hard caps, and high-fee warning thresholds
- `src/services/chain-service.ts` — persisted active-chain store for the network switcher
- `src/services/theme-service.ts` — persisted light/dark/system theme store
- `src/services/wallet-service.ts` — create, import, unlock (password or biometric), lock, and send lifecycle
- `src/services/transaction-service.ts` — EIP-1559 fee-capped native and token transfers with viem
- `src/services/balance-service.ts` — native balance reads for the active chain
- `src/services/token-service.ts` — ERC-20 metadata and balance reads from the active chain's RPC
- `src/services/nft-service.ts` — ERC-721/ERC-1155 metadata URI and public metadata reads
- `src/services/etherscan-history.ts` — server-only Etherscan V2 activity adapter
- `src/services/transaction-history.ts` — history item and pagination-cursor validation shared by the route and the UI
- `src/services/account-abstraction-service.ts` — EIP-7702 delegation reads and revocation
- `src/app/api/transactions/route.ts` — validated same-origin history endpoint
- `src/lib/address.ts` — address truncation for display
- `src/lib/theme.ts` — theme-mode validation and light/dark resolution
- `src/lib/base64.ts` — shared base64 and base64url helpers for vaults and credentials
- `src/lib/clipboard.ts` — clipboard writes with an `execCommand` fallback
- `src/lib/use-active-chain.ts` — React hook that subscribes to the persisted active-chain store
- `src/types/transaction-history.ts` — shared transaction-history types

Wallet creation displays a recovery phrase before asking the user to confirm
its backup and set a password. The vault is not persisted before confirmation.
Import and unlock are local operations. Locking clears the service's in-memory
derived keys and account state, including on page unload. Native and token
transfers show the EIP-1559 gas limit, max fee per gas, priority fee, and
maximum network fee before confirmation. The browser UI is still a
self-custody wallet MVP: testnets hold worthless funds, mainnets move real
assets, and you should never enter a recovery phrase used for real funds.

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

## Importing a private key

Besides a recovery phrase, `/import/private-key` can restore a single private
key. A raw key has no BIP-32 lineage, so it becomes its own wallet with exactly
one account (addressed by the sentinel path `imported`): it cannot derive
further accounts, and the home screen lists it under a separate **Imported
accounts** section rather than among the recovery-phrase wallets. The Unlock
screen's wallet picker groups the two kinds the same way, and the two import
pages are single-purpose: `/import` restores a recovery phrase, while
`/import/private-key` restores a key (no method switch between them). The key is
normalized (an optional `0x` prefix is accepted), validated as a secp256k1
scalar, and its address derived before anything is written; the key is only ever
persisted inside the same AES-GCM vault as a recovery phrase, stored as a tagged
secret (`core/vault-secret.ts`) so existing bare-phrase vaults keep working
unchanged. Because a lone key has no recovery phrase, losing it means losing the
funds, so the import form warns the user before continuing. Private-key wallets
support the same lock, reveal, send, token, and NFT flows as mnemonic wallets,
including biometric unlock, which wraps the key exactly as it wraps a recovery
phrase.

The wallet overview includes a Tokens tab for manually added ERC-20 contracts
on the active chain. Token name, symbol, decimals, and the selected account's
current balance are read directly from the contract through the configured RPC.
Contract metadata and hidden/visible state are stored per account and per chain;
balances are refreshed from chain and are never persisted. Zero-balance tokens
remain listed. Hide a token to remove it from the portfolio list, then restore
it from token management. This is not automatic token discovery: only contracts
added by the user are shown.

The NFTs tab lets the user add a contract, token ID, and ERC-721/ERC-1155
standard to the selected account's local list. The wallet reads `tokenURI` or
`uri` from the active chain and loads the returned metadata: inline `data:` JSON is
decoded in place, `ipfs://` is resolved through `https://ipfs.io`, `ar://`
through `https://arweave.net`, and HTTPS URLs (including scheme-less `host/path`
values that some contracts return) are fetched directly. Metadata and image
links are untrusted public content; only public HTTPS and inline images are
used, loopback/private hosts are refused, redirects are accepted only when the
final URL is still public HTTPS, metadata requests omit credentials and
referrers, responses are capped at 256 KiB, and descriptions are rendered as
text. The metadata or image host still sees your IP address; only a proxy would
hide it. A broken or oversized `image`
field only drops the picture, never the NFT entry. NFT records are public
display metadata stored per account, and ownership is verified on chain: adding
an entry calls `ownerOf` (ERC-721) or `balanceOf` (ERC-1155) and refuses tokens
the selected account does not hold, so a token that fails ownership cannot be
listed. The check is repeated whenever a wallet session starts, the account or
chain changes, or the NFT list is opened, which removes entries the account no
longer owns after a transfer. Only a definitive "not owned" answer deletes an entry: a
reverting `ownerOf` (for example a burned token) or an unreachable RPC keeps the
entry, so a network hiccup can never silently wipe the list. The wallet still
never discovers NFTs automatically. Removing an entry only removes it from the
local list and has no on-chain effect. Metadata fetch, CORS, gateway, or
ownership-read errors are surfaced as fixed local messages so the user can
retry; raw provider or gateway text is never rendered.

## Biometric unlock

Unlock the wallet with Touch ID or Face ID instead of typing the password. The
feature is opt-in per device: enable it from the wallet's Settings page by
confirming the password, which creates a platform passkey and wraps a second
copy of the recovery phrase under a key derived from the passkey's WebAuthn PRF
extension (`HKDF-SHA256`, then `AES-GCM`). Touch ID / Face ID is therefore
cryptographically required to decrypt that copy: the wrapped phrase stored in
`wallet_biometric_v1` is useless without the passkey. The password vault is
unchanged and always works as the fallback, and the same recovery phrase and
accounts are restored either way.

Enrollment is gated on a runtime capability check — the browser must be in a
secure context, expose a user-verifying platform authenticator, and return a PRF
result. If any of those fail, the option is hidden and nothing is stored.
Biometric unlock is per device. The passkey itself may sync through the OS
provider (iCloud Keychain on Apple devices, Google Password Manager elsewhere),
but the encrypted vault stays in this browser's IndexedDB, so a new device needs one
password unlock before biometric unlock can be enabled there. Turning it off
removes the local wrapped vault; the passkey is removed from the OS keychain by
the user. The Touch ID / Face ID ceremony cannot be automated in tests and
should be verified manually on a real device.

## Networks

The network switcher in the header selects the active chain. The selection is a
UI preference stored in `wallet_active_chain_v1`; it never touches keys or the
vault, and it defaults to Sepolia when unset or invalid. Supported networks:

- Mainnets: Ethereum, Base, Arbitrum One, OP Mainnet, Polygon
- Testnets: Sepolia, Base Sepolia

Each chain resolves an RPC endpoint from a `NEXT_PUBLIC_RPC_URL_<chainId>`
environment override, falling back to a public endpoint when unset. See
`.env.example`. The registry in `src/core/chain.ts` is the single source of
truth for native currency, block explorer, and RPC details, so native symbols
(for example POL on Polygon) always come from the chain definition.

Tokens and NFTs are stored per account and tagged with their chain. Entries
saved before multi-chain support (which had no chain) are treated as Sepolia.
Switching chains filters the portfolio, balances, and activity feed to that
network, and the send form only offers assets tracked on the active chain.

Transfers are priced with EIP-1559 `maxFeePerGas` and `maxPriorityFeePerGas`
from the active RPC. The wallet refuses to sign when the gas limit exceeds
1,000,000, the max fee exceeds 1,000 gwei, the priority fee exceeds 50 gwei, or
the maximum total fee exceeds 0.1 native token. The review warns above 100 gwei
or 0.01 native. The RPC still chooses the base-fee proposal and gas estimate
within those bounds, and OP/Base L1 data fees are charged in addition to the
displayed execution fee.

## Appearance

The header's theme menu switches the whole app between light, dark, and
follow-system. The choice is a display-only preference stored in
`wallet_theme_v1` and defaults to dark; like the network selection it never
touches keys or the vault, and it is kept across locks and reloads. System mode
follows the OS `prefers-color-scheme` setting live and updates when another tab
changes the preference. A tiny inline script applies the stored palette before
the first paint, so a user who chose light does not see a flash of the dark
theme while the app hydrates.

## Transaction history

The wallet dashboard has separate tabs for normal native transactions, internal
native transfers, and ERC-20 token transfers from Etherscan API V2 for the
active chain. Each tab loads and paginates only its own Etherscan source without
exposing the API key to browser code. NFT activity and token holdings are not
included. The server pins the active chain's current block height into the
signed pagination cursor, so new blocks do not shift the upstream offset pages
mid-session.

Chains the free Etherscan tier does not serve (Base and OP Mainnet at the time
of writing) are marked `historySupported: false` in the registry and show a
clear "activity is not available for this network yet" state instead of an
error. The history service also detects paid-plan responses at runtime, so a
plan change degrades gracefully rather than surfacing a raw provider error.

Set `ETHERSCAN_API_KEY` in the repository's ignored `.env` file for local
development, and provide the same server-only environment variable in
deployment. Production also needs `HISTORY_CURSOR_SECRET` (for example
`openssl rand -hex 32`), which signs pagination cursors independently of the
Etherscan key; history returns `503` until it is set. Do not prefix either
variable with `NEXT_PUBLIC_`. Browser requests must be same-origin and JSON
(cross-site and non-JSON calls are rejected), and the route applies an in-memory
rate limit per IP (30 requests/minute) and per public address (20 requests per
minute) in each server instance; non-browser callers are subject to the same
rate limits. Only the public wallet
address and the selected activity kind and signed continuation cursor are sent
to the app's history route; wallet mnemonics and private keys are never sent.
The server route requires a running Next.js server and does not work as a
static export.

The free Etherscan tier supports a subset of chains, allows up to 3 API calls
per second, and 100,000 calls per day. A history page requests one page from its
selected activity source; provider limits or outages are shown as retryable
errors, and unsupported chains show the unavailable state described above. NFT
transaction history, token holdings, and automatic asset discovery are not
included.
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
