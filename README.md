# My Wallet

A client-side, non-custodial EVM wallet MVP. The project has a presentational
app shell, Core primitives, and a WalletService for the wallet lifecycle. UI,
balance, and transaction flows are not connected yet.

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
- `src/core/storage.ts` — encrypted-vault-only browser storage
- `src/core/chain.ts` — Sepolia chain and viem public client
- `src/services/wallet-service.ts` — create, import, unlock, lock, and send lifecycle
- `src/services/transaction-service.ts` — estimated-gas native transfers with viem
- `src/store/`, `src/types/`, `src/lib/` — reserved for follow-up state and shared utilities

Wallet creation uses `prepareWallet()` to show the recovery phrase, followed
by `createWallet(password, true)` after the user confirms its backup. The vault
is not persisted before confirmation. Locking clears the service's in-memory
private key and address. The preview pages do not call the service, and no
wallet operation is currently wired into the UI.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
