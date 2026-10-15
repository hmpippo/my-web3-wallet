# My Wallet

A client-side, non-custodial EVM wallet MVP. The project currently has a
presentational app shell and isolated Core primitives. Wallet lifecycle,
account state, balances, and transaction flows are not connected yet.

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
- `src/services/`, `src/store/`, `src/types/`, `src/lib/` — reserved for follow-up
  service, state, and shared utility work

The preview pages do not call these Core primitives and do not create, unlock,
or send from a wallet. `localStorage` is only used for the encrypted vault
format; mnemonic/private-key lifecycle management will be implemented in a
later step.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
