# My Wallet

A client-side, non-custodial EVM wallet MVP. The app includes wallet setup,
import, unlock, balance, and native-transfer flows for Sepolia testnet.

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
- `src/services/balance-service.ts` — native Sepolia balance reads
- `src/store/`, `src/types/`, `src/lib/` — reserved for follow-up state and shared utilities

Wallet creation displays a recovery phrase before asking the user to confirm
its backup and set a password. The vault is not persisted before confirmation.
Import and unlock are local operations. Locking clears the service's in-memory
private key and address, including on page unload. Native transfers show an
estimated fee before confirmation. The browser UI is still a self-custody
wallet MVP: use Sepolia testnet only, and never enter a recovery phrase used
for real funds.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
