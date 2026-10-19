# Security Audit — `my-wallet` (non-custodial EVM wallet)

| | |
|---|---|
| **Date** | 2026-10-19 |
| **Auditor** | AI static review (not an independent human audit) |
| **Scope** | `src/` (core, services, API route, components), `next.config.ts`, CI workflows, git state, dependency list |
| **Method** | Manual static source review. No runtime/dynamic testing. No CVE feed available. |
| **Deployment context** | Vercel |
| **Threat model** | Same as `AGENTS.md` §9: attacker without physical access; XSS assumed impossible; vault at rest in the browser; the user is the only signer. |

---

## 1. Executive summary

The cryptographic core is **well built and unusually disciplined**: audited libraries, correct WebCrypto usage, secrets zeroized where the platform allows, and every value read back from storage is re-validated rather than trusted. There are no critical, directly exploitable key-theft bugs in the code.

The exposure is almost entirely *around* the crypto. The design assumes "no script will ever run on this origin" (`AGENTS.md` §9), yet the app ships **no Content-Security-Policy**, keeps every vault in `localStorage`, and **never auto-locks**. Those three combine into the wallet's real risk: a single future XSS — a dependency compromise, a new `dangerouslySetInnerHTML`, an injected third-party script — becomes wholesale vault extraction, and nothing in the current configuration slows it down.

Recommended order of work: **H1** (cheap, high value), then **H2 + M1**, then **M2/M3**.

### Findings at a glance

| # | Severity | Finding |
|---|----------|---------|
| H1 | **High** | No CSP / clickjacking / security headers at all — **fixed in phase 1** |
| H2 | **High** | Secrets lived in `localStorage` (spec said IndexedDB), no at-rest protection — **fixed** |
| M1 | Medium | No idle/session timeout; keys stay in memory until `pagehide` |
| M2 | Medium | Offline brute-force: 8-char minimum, no strength rule, no throttle |
| M3 | Medium | `/api/transactions` is an unauthenticated, unthrottled Etherscan proxy |
| M4 | Medium | Secret residue in un-zeroizable JS strings (mnemonics/keys) |
| M5 | Medium | Single trusted RPC for balances, nonce, gas, broadcast, delegation reads |
| L1 | Low | `data:image/svg+xml` accepted as an NFT image |
| L2 | Low | Legacy `gasPrice` pricing, no absolute fee cap |
| L3 | Low | NFT metadata fetch follows redirects off the gateways; leaks user IP |
| L4 | Low | Untrusted provider error text reflected into the UI |
| L5 | Low | Live `ETHERSCAN_API_KEY` on disk in `.env` |
| I1 | Info | Dependency CVE scan not possible with the current registry |

---

## 2. High severity

### H1 — No Content-Security-Policy or any security headers

**Evidence:** `next.config.ts` defines no `headers()`, and there is no middleware. Next.js adds none by default, so the deployed app currently has no `Content-Security-Policy`, no `frame-ancestors` / `X-Frame-Options`, no `Referrer-Policy`, and no `Permissions-Policy`.

**Impact:**

- **No CSP.** The entire wallet design depends on "no script can run on this origin," since the encrypted vault, the biometric-wrapped secret, and the exported private keys are all reachable from same-origin JavaScript. With no CSP, one XSS — a compromised dependency, a future `dangerouslySetInnerHTML`, a malicious script — becomes vault exfiltration with a single `localStorage.getItem("wallet_vault_v1:<id>")`. CSP is the one defense-in-depth layer that turns "one bug = total loss" into "one bug = contained."
- **No framing protection.** The wallet renders fully inside an iframe today, so **clickjacking** can steer a user into clicking **Confirm and send**, **Confirm revoke** (EIP-7702), or **Reveal private key**.
- No `Referrer-Policy`, so the app URL (and, in the history flow, the queried address) can leak in `Referer` to linked sites such as block explorers.
- No `Permissions-Policy`.

**Vercel specifics:**

- Vercel honors `headers()` from `next.config.ts`, so this is the right place — no reverse proxy required.
- Vercel's edge already sends **HSTS** and **`X-Content-Type-Options: nosniff`**; those are effectively covered by the platform and should not be duplicated.
- **Not** added automatically and therefore required here: CSP, `frame-ancestors` / `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

**Remediation:**

**Status: fixed in phase 1** (static policy, `next.config.ts` `headers()`).

A strict CSP in this app cannot use a hash-only `script-src`. The App Router streams RSC data through inline `self.__next_f.push(...)` scripts whose content varies per page, so a `'sha256-…'` hash for the theme script alone would break hydration. There are two viable models:

- **Phase 1 (implemented): static policy with `script-src 'self' 'unsafe-inline'`.** It enforces what it can without changing rendering: no external script origins, no `eval`, no `object`/`embed`, no framing, no form exfiltration, and restricted `connect-src`/`img-src`. It does **not** stop inline-script injection; that requires phase 2.
- **Phase 2 (not implemented): nonce + `'strict-dynamic'` in `middleware.ts`.** Next.js reads the nonce from the CSP header and stamps its own scripts (`next/dist/server/app-render/get-script-nonce-from-header.js`), but a per-request nonce forces **every route to render dynamically**, ending static HTML and CDN caching. That is an architecture decision, not a header tweak.

The implemented header set, applied to `/:path*`:

- `Content-Security-Policy`:
  - `default-src 'self'`, `base-uri 'none'`, `object-src 'none'`
  - `frame-ancestors 'none'`, `frame-src 'none'`, `form-action 'self'`
  - `script-src 'self' 'unsafe-inline'` (`'unsafe-eval'` added only in development for Turbopack HMR)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: blob: https:` — NFT art may be inline `data:` or any public HTTPS host (`src/core/url-safety.ts`)
  - `connect-src 'self' https:` (`ws: wss:` added only in development) — `'self'` covers `/api/transactions`
  - `font-src 'self'`, `manifest-src 'self'`, `worker-src 'self' blob:`
- `X-Frame-Options: DENY` (belt-and-braces alongside `frame-ancestors 'none'`)
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff` (Vercel also sets this; kept so self-hosting is correct)
- `Permissions-Policy` — `camera`, `microphone`, and `geolocation` disabled, while **`publickey-credentials-create` / `publickey-credentials-get` are explicitly kept enabled** so biometric unlock (`src/core/webauthn.ts`) still works.

**Known residual gaps in phase 1:**

- `'unsafe-inline'` in `script-src` means an HTML-injection XSS would still execute; only phase 2 closes this.
- `connect-src https:` is broad because NFT metadata may be fetched from any public HTTPS host (`src/services/nft-service.ts`). It blocks `http:`, `ws:`, and non-HTTPS exfiltration, but **not** exfiltration to an arbitrary HTTPS endpoint. Tightening it requires the L3 gateway allow-list first.
- `api.etherscan.io` is deliberately absent from `connect-src`: the history call is server-side (`src/services/etherscan-history.ts`) and must stay that way.

### H2 — Encrypted vault and biometric vault stored in `localStorage`

**Status: fixed.** Wallet records now live in **IndexedDB** (`src/core/storage-backend.ts`), behind the unchanged `StorageService` interface. Existing `localStorage` installs are imported once on first load and the legacy copies are removed (`src/core/storage.ts`). Theme and active-chain preferences stay in `localStorage`; they contain no key material.

**Evidence (pre-fix):** `src/core/storage.ts` used `window.localStorage` for:

- `wallet_vault_v1:<walletId>` — the AES-GCM encrypted recovery phrase / private key
- `wallet_account_metadata_v1:<walletId>`
- `wallet_biometric_v1:<walletId>` — the PRF-wrapped secret
- `wallet_registry_v1`

`AGENTS.md` §4.3 explicitly recommends **indexedDB**.

**Impact (pre-fix):**

- Any same-origin script read **all** vaults synchronously and in bulk — no iteration, no async, no size limits in the way (see H1).
- `localStorage` is **not** partitioned in the way cookies are; it is shared by everything served from the same origin. If this app ever shares a host/domain/subpath with other pages, those pages can read the vaults.
- The blob is plaintext-at-rest within the browser profile: it is included in profile backups/sync and readable from a forensic image, with no OS keychain involvement.

**Remediation (implemented):**

- `StorageService` sits on a small async key-value backend; `createIndexedDbBackend()` stores JSON strings in database `my-wallet`, object store `records`.
- The one-time migration enumerates `wallet_registry_v1`, `wallet_vault_v1*`, `wallet_accounts_v1*`, and `wallet_biometric_v1*`, commits them to IndexedDB in a single transaction, writes a migration marker, and only then deletes the `localStorage` copies. A failed write leaves `localStorage` intact and retries on the next call.
- `clearVault` deletes the vault, metadata, and biometric record in one transaction.
- The legacy single-wallet adoption path now runs against IndexedDB and writes the registry before dropping the bare keys, so a crash cannot strand a re-keyed vault.
- A best-effort `navigator.storage.persist()` request is made after the first successful write.

**Residual risk (not removed by this fix):**

- IndexedDB is still same-origin: script that can run on the page can read and exfiltrate the vaults. Only the H1 phase-2 nonce CSP plus a short unlock/sign window materially reduces that.
- IndexedDB is plaintext-at-rest inside the browser profile exactly like `localStorage`; it is included in profile backups/sync and in forensic images.
- IndexedDB is evictable (Safari's 7-day cap, storage pressure). The recovery phrase remains the only real backup; persistence reduces but does not remove the risk.

What the move does buy: no synchronous single-call dump of every vault, wallets out of the `localStorage` namespace shared by every same-origin page, and alignment with `AGENTS.md` §4.3.

---

## 3. Medium severity

### M1 — No idle timeout; `lock()` only fires on `pagehide`

**Evidence:** `src/components/wallet-unload-lock.tsx` registers `pagehide` only. `walletService.lock()` is invoked on unload, on wallet switch, and around create/import — but there is no idle timer and no `visibilitychange` handling anywhere in `src/`.

**Impact:** a wallet left unlocked on a shared or borrowed machine keeps every derived private key in `WalletService.privateKeys` indefinitely, and keeps `signAndSendTransaction` / `revealPrivateKey` reachable. A backgrounded mobile tab stays unlocked the same way. This directly widens the M4 window.

**Remediation:** add a configurable idle timeout (for example 5 minutes of no interaction → `lock()`), lock on `visibilitychange` to `hidden` after a short grace period, and surface a "locked due to inactivity" notice so the relock is not mistaken for a bug.

### M2 — Offline brute-force of the vault

**Evidence:** `src/core/crypto.ts` — PBKDF2-SHA256 × 600 000, AES-GCM-256, 128-bit tag, fresh 16-byte salt and 12-byte IV per encryption. `validatePassword` enforces only `length >= 8`. There is no strength/entropy check, no breached-password check, and no attempt throttling on `unlock()`.

**Impact:** because the ciphertext is local (H2), an attacker who obtains it attacks it **offline**. PBKDF2-SHA256 at 600 000 iterations is roughly tens of thousands of guesses per second on a single modern GPU, so an 8-character memoryless password is recoverable. 600k is a reasonable parameter choice; the weak link is the password policy, not the KDF.

**Remediation:** require (or strongly nudge) a passphrase, e.g. a minimum length plus a visible entropy/strength meter with an explicit warning, and consider raising iterations. Document the offline-attack reality in the UI and README, since it is intrinsic to any client-side vault.

### M3 — `/api/transactions` is an open proxy to the Etherscan key

**Evidence:** `src/app/api/transactions/route.ts` accepts any POST with `{ address, chainid }` and calls `getEtherscanHistory`, which spends the server's `ETHERSCAN_API_KEY`. There is no auth, no origin check, and no rate limit; `inFlightPages` only de-duplicates *identical concurrent* requests, so a sweep across many addresses is unthrottled. The cursor HMAC uses the API key as the HMAC secret (`createHmac("sha256", apiKey)`).

**Impact:**

- A third party can drain the Etherscan quota and drive up cost.
- Coupling the signing secret to the API key means rotating the key invalidates all in-flight cursors.

**Remediation:** add rate limiting (per-IP and/or per-address) and, if the endpoint is only meant for the app, an `Origin`/`Sec-Fetch-Site` check. Derive a separate HMAC key (e.g. `HISTORY_CURSOR_SECRET`) so cursor signing and the Etherscan key are independent.

**Note (positive):** the handler's response handling is strong — strict request byte cap, strict JSON and shape validation, `Cache-Control: no-store`, and the secret never reaches the client bundle (`import "server-only"` plus a non-`NEXT_PUBLIC_` name).

### M4 — Secret residue in un-zeroizable JS strings

**Evidence:** `WalletService` zeroizes what it can — `seed.fill(0)` in `finally` blocks and `HDKey.wipePrivateData()` (`src/core/hd-wallet.ts`, driven from `src/services/wallet-service.ts`). But the same secrets also exist as immutable `string`s:

- `WalletService.pendingWallet.mnemonic` and `pendingWallet.privateKey`
- the `privateKeys: Map<number, Hex>` values
- the `privateKey` in React state (`src/components/reveal-private-key.tsx`)

JavaScript strings cannot be zeroized. `lock()` drops the references, but heap copies persist until garbage collection.

**Impact:** a heap snapshot, crash core dump, or attached debugger can recover a mnemonic or key that is believed to be cleared. Combined with M1's long unlock window, the exposure window is large.

**Remediation:** minimize post-activation retention of the mnemonic, hold keys as `Uint8Array` where practical, and document the limitation honestly rather than implying full wiping.

### M5 — Single trusted RPC

**Evidence:** `src/core/chain.ts` resolves one endpoint per chain (publicnode default, `NEXT_PUBLIC_RPC_URL_*` override) and `getPublicClient` caches one client per chain. That endpoint serves balances, nonce, gas price, EIP-7702 delegation reads (`eth_getCode`), and the transaction broadcast.

**Impact:** a malicious or compromised RPC can misreport balances, propose extreme gas prices (see L2), lie about delegation state on the account-abstraction screen, and censor transactions. This is inherent to a lightweight client.

**Remediation:** acknowledge in the README, keep the `NEXT_PUBLIC_RPC_URL_*` override as the documented mitigation, and consider allowing a user-configured endpoint.

---

## 4. Low severity

- **L1 — `data:image/svg+xml` accepted.** `isImageMediaType` in `src/core/url-safety.ts` is `startsWith("image/")`, so SVG is allowed. It renders via `<img>` in `src/components/nft-portfolio.tsx`, where SVG scripts do **not** execute, so this is **not XSS** — but it permits convincing fake-UI/phishing images and inflates `localStorage`. Consider an explicit raster allow-list (`image/png`, `image/jpeg`, `image/webp`, `image/gif`) or rejecting SVG.
- **L2 — Legacy `gasPrice`, no absolute fee cap.** `src/services/transaction-service.ts` uses `getGasPrice` + `gas` rather than EIP-1559 fees, and passes reviewed values straight through with no hard ceiling. The review screen (`src/components/send-form.tsx`) shows the estimated fee, which limits the blast radius, but an attacker-controlled RPC can still propose an extreme price. Consider `maxFeePerGas` with a sane cap and a "fee is unusually high" warning.
- **L3 — NFT metadata fetch follows redirects off the gateways.** `fetchNftJson` in `src/services/nft-service.ts` sets `redirect: "follow"` with no allow-list. `isPrivateHostname` blocks literal private hosts, but a public host can redirect elsewhere, and the fetch **leaks the user's IP address** to arbitrary metadata servers. An explicit gateway allow-list (`ipfs.io`, `arweave.net`, plus your configured gateways) would tighten this.
- **L4 — Untrusted provider error text reflected into the UI.** `assertNftOwned` appends `error.message`, and several services embed upstream messages. React escapes them so there is no XSS, but untrusted text becomes user-visible — a phishing-adjacent surface. Consider mapping upstream errors to fixed, local strings.
- **L5 — Live `ETHERSCAN_API_KEY` on disk.** The key in `.env` is correctly gitignored (`git check-ignore` confirms `.env` matches `.gitignore:34`) and **was never committed** (`git log --all -- .env` returns nothing; only `.env.example` is tracked). It has, however, been read during this audit — treat it as exposed and **rotate it**. Never commit it; never place it in a shared worktree.

---

## 5. Informational

- **I1 — Dependency CVE scan not performed.** `pnpm audit` fails against the configured registry (`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`: `registry.npmmirror.com` does not implement the advisories endpoint). Direct dependencies of note: `next@16.4.0`, `viem@2.57.6`, `@scure/bip32@^2.4.0`, `@scure/bip39@^2.4.0`, `react@19.3.0`. Add a CVE scan (a registry with the advisories endpoint, or Dependabot/OSV) to CI. `lint.yml` and `test.yml` exist but do not scan dependencies.
- **Not verified:** no runtime/dynamic testing was performed. `AGENTS.md` §11 requires the `next-dev-loop` skill for runtime verification; a remediation pass should run `pnpm test`, `pnpm typecheck`, and a browser check.

---

## 6. Controls that are working well (preserve these)

- **Crypto core is textbook.** WebCrypto PBKDF2-SHA256/600k + AES-GCM-256; fresh salt and IV per encryption; strict base64, length, and version validation; typed `VaultDecryptionError`; tests cover round-trip, salt/IV uniqueness, and wrong-password rejection (`src/core/crypto.test.ts`).
- **HD wallet handling.** Audited `@scure` libraries, `wipePrivateData()`, seed zeroized on every error path, index bounds enforced, and a documented default path.
- **Storage is tamper-resistant.** Every value read from storage is re-validated and reconstructed rather than trusted: derivation paths canonicalized, chain IDs restricted to supported networks, NFT/token/name lengths capped, duplicates rejected, and wallet ids matched against `WALLET_ID_PATTERN` before being used in a storage key (`src/core/storage.ts`).
- **Private keys are never trusted from storage.** `revealPrivateKey` re-derives the key and cross-checks it against the session account's address before returning it.
- **No logging of secrets.** There are zero `console.*` calls in `src/`.
- **NFT ownership checks are deliberately asymmetric.** Fail-closed when adding an NFT (an unproven token is refused) and fail-open when pruning (only a definitive "not owned" removes an entry), so a flaky RPC can never wipe the local list (`src/services/nft-service.ts`, `syncNftOwnership`).
- **Biometric unlock is well isolated.** Password re-confirmation to enroll, PRF verified *before* anything is persisted, record bound to `rpId`, discoverable + user-verified credentials, and `prfOutput` zeroized (`src/core/webauthn.ts`, `src/core/biometric-vault.ts`).
- **Minimal attack surface.** No third-party scripts, no analytics, no telemetry; API responses are `no-store`; the Etherscan secret is `server-only` and cannot enter the client bundle.
- **Test coverage.** 210 unit tests, including crypto round-trip, wrong-password rejection, and deterministic derivation.

---

## 7. Appendix — verification log

| Check | Result |
|---|---|
| `console.*` / `eval` / `innerHTML` in `src/` | None (one static `dangerouslySetInnerHTML` in `theme-script.tsx`, safe today) |
| `.env` tracked by git | No — ignored at `.gitignore:34`, never in history |
| Secrets in `localStorage` | Fixed — IndexedDB with one-time import of existing installs (H2) |
| Idle / auto-lock | Absent (M1) |
| Security headers | Present in production — verified by `curl -I` and a production browser pass (H1, phase 1) |
| `pnpm audit` | Failed — registry lacks the advisories endpoint (I1) |
| Runtime verification | Not performed |

**Priority order for remediation:** H1 → H2 + M1 → M2/M3 → M4/M5 → L1–L5 → I1.
