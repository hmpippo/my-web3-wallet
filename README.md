# My Wallet

A client-side, non-custodial EVM wallet MVP. The current version is the app
shell only: wallet creation, recovery, key handling, storage, balances, and
transactions are intentionally not implemented yet.

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
- `src/core/` — reserved for wallet primitives
- `src/services/` — reserved for wallet and chain services
- `src/store/` — reserved for in-memory UI state
- `src/types/` and `src/lib/` — reserved for shared types and utilities

Core-layer work will be added in a later step. Do not treat the preview pages as
functional wallet operations.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
