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

The exposure was almost entirely *around* the crypto. The design assumes "no script will ever run on this origin" (`AGENTS.md` §9), yet the app originally shipped **no Content-Security-Policy**, kept every vault in `localStorage`, and **never auto-locked**. Those three combined into the wallet's real risk: a single future XSS — a dependency compromise, a new `dangerouslySetInnerHTML`, an injected third-party script — became wholesale vault extraction. H1 and H2 are fixed and M1/M2 are mitigated below; the remaining findings are lower-severity and mostly operational.

Remediation so far: **H1** (CSP and headers), **H2** (IndexedDB), **M1** (30-second idle lock), **M2** (strength nudge and unlock cooldown), **M3** (same-origin gate, rate limits, separate cursor secret), **M4** (byte-backed keys and zeroizable pending entropy, with a documented residual). Remaining: **M5**, then **L1–L5**, then **I1**.

### Findings at a glance

| # | Severity | Finding |
|---|----------|---------|
| H1 | **High** | No CSP / clickjacking / security headers at all — **fixed in phase 1** |
| H2 | **High** | Secrets lived in `localStorage` (spec said IndexedDB), no at-rest protection — **fixed** |
| M1 | Medium | No idle/session timeout; keys stay in memory until `pagehide` — **fixed** |
| M2 | Medium | Offline brute-force: 8-char minimum, no strength rule, no throttle — **mitigated** |
| M3 | Medium | `/api/transactions` proxy — **mitigated** (origin gate, rate limits, separate cursor secret) |
| M4 | Medium | Secret residue in un-zeroizable JS strings — **mitigated**, residual documented |
| M5 | Medium | Single trusted RPC for balances, nonce, gas, broadcast, delegation reads |
| L1 | Low | `data:image/svg+xml` accepted as an NFT image |
| L2 | Low | EIP-1559 fees with hard caps — **mitigated**, residual documented |
| L3 | Low | NFT metadata redirects and IP visibility — **mitigated**, residual documented |
| L4 | Low | Untrusted provider error text reflected into the UI — **fixed** |
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
- `connect-src https:` is broad because NFT metadata may be fetched from any public HTTPS host (`src/services/nft-service.ts`). It blocks `http:`, `ws:`, and non-HTTPS exfiltration, but **not** exfiltration to an arbitrary HTTPS endpoint. Tightening it requires restricting metadata and image hosts to an allow-list; that product-scope reduction was considered for L3 and deliberately not taken, so `connect-src https:` stays broad.
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

### M1 — No idle timeout; `lock()` only fired on `pagehide`

**Status: fixed.**

**Evidence (pre-fix):** `src/components/wallet-unload-lock.tsx` registered `pagehide` only. `walletService.lock()` was invoked on unload, on wallet switch, and around create/import — but there was no idle timer and no `visibilitychange` handling anywhere in `src/`.

**Impact:** a wallet left unlocked on a shared or borrowed machine kept every derived private key in `WalletService.privateKeys` indefinitely, and kept `signAndSendTransaction` / `revealPrivateKey` reachable. A backgrounded mobile tab stayed unlocked the same way. This directly widened the M4 window.

**Remediation implemented:**

- `src/lib/idle-lock.ts` — a framework-free controller with an **absolute 30-second deadline**. `noteActivity()` resets it; `check()` locks when wall-clock time passed the deadline while timers were suspended.
- `src/components/wallet-idle-lock.tsx`, mounted from `src/app/layout.tsx`, listens for `pointerdown`, `keydown`, `touchstart`, `wheel`, and `scroll` (capture phase), and re-checks on `visibilitychange`. Focus/visibility events do **not** count as activity, so returning to an expired tab cannot revive it.
- `WalletService.lock("inactivity")` plus `getLockReason()`; the unlock form shows "Locked after 30 seconds of inactivity." so the relock is not mistaken for a bug.
- The existing `pagehide` handler remains as defense in depth.

**Residual:** 30 seconds is deliberately aggressive; a user can be locked mid-form. The timer is absolute, so a background tab that is never revisited still locks on the next visibility check even if the browser throttled the timer.

### M2 — Offline brute-force of the vault

**Status: mitigated, with an explicitly accepted residual risk.**

**Evidence (pre-fix):** `src/core/crypto.ts` — PBKDF2-SHA256 × 600 000, AES-GCM-256, 128-bit tag, fresh 16-byte salt and 12-byte IV per encryption. `validatePassword` enforced only `length >= 8`. There was no strength/entropy check, no breached-password check, and no attempt throttling on `unlock()`.

**Impact:** because the ciphertext is local (H2), an attacker who obtains it attacks it **offline**. PBKDF2-SHA256 at 600 000 iterations is roughly tens of thousands of guesses per second on a single modern GPU, so an 8-character memoryless password is recoverable. 600k is a reasonable parameter choice; the weak link is the password policy, not the KDF.

**Remediation implemented:**

- `src/core/password.ts` + `src/components/password-strength.tsx` — an advisory **weak / fair / strong** meter with a common-pattern list and explicit copy that anyone who obtains the encrypted vault can guess offline. It never blocks submission. The hard requirement stays at **8 characters**, so existing vaults and passwords remain valid.
- `src/lib/unlock-throttle.ts` — after **3 wrong passwords** the third failure itself reports the **30-second cooldown**; the unlock button is disabled and counts the cooldown down in place. The counter resets after the cooldown, persists per wallet in `localStorage` (a non-secret failure counter, not key material), clears on success, and expires after 24 h. `cooldownMs` and the clock are injectable for tests.
- The KDF is unchanged (PBKDF2-SHA256 × 600 000, AES-GCM-256).

**Residual / accepted risk:** the throttle only slows attempts made *through the app*; an attacker who copies the vault bypasses it entirely. With the minimum still at 8 characters and no breached-password list, a determined user can still pick a weak password. The meaningful offline controls remain the PBKDF2 cost and the advisory meter. Raising the minimum would reject passwords already used with existing vaults and was rejected for this iteration; if it is raised later, `validatePassword` and the unlock path need a compatibility decision.

### M3 — `/api/transactions` is an open proxy to the Etherscan key

**Evidence:** `src/app/api/transactions/route.ts` accepts any POST with `{ address, chainid }` and calls `getEtherscanHistory`, which spends the server's `ETHERSCAN_API_KEY`. There is no auth, no origin check, and no rate limit; `inFlightPages` only de-duplicates *identical concurrent* requests, so a sweep across many addresses is unthrottled. The cursor HMAC uses the API key as the HMAC secret (`createHmac("sha256", apiKey)`).

**Impact:**

- A third party can drain the Etherscan quota and drive up cost.
- Coupling the signing secret to the API key means rotating the key invalidates all in-flight cursors.

**Status: mitigated.** Three layers, all server-side:

- **Same-origin gate** (`src/app/api/transactions/route.ts`). Requests whose `Sec-Fetch-Site` is anything other than `same-origin`/`none`, or whose `Origin` host differs from the request host, get `403`. The body must be `application/json`, otherwise `415`. This stops a browser page on another origin from driving the route; it is deliberately not authentication, because non-browser callers can omit both headers.
- **Fixed-window rate limits** (`src/lib/rate-limit.ts`, `src/lib/history-rate-limit.ts`). 30 requests/minute per client IP and 20 requests/minute per public address, returning `429` with `Retry-After`. The IP budget is consumed before the body is read; the address budget after validation. Expired buckets are pruned and the map is bounded.
- **Independent cursor key** (`src/services/etherscan-history.ts`). Cursors are signed with `HISTORY_CURSOR_SECRET` (minimum 32 characters), not the Etherscan key. Missing or too-short secrets produce a `config` error mapped to `503` in production; development falls back to the API key so a fresh clone still works. Set it with `openssl rand -hex 32` (`README.md`, `.env.example`).

**Residual / accepted risk:** the limiter is in process memory, so on a multi-instance deployment (Vercel) each instance enforces its own share and the effective global rate is `instances × limit`. A shared store (Upstash Redis / Vercel KV) would make the limits global but adds a dependency and a network hop; deferred deliberately. `x-forwarded-for` is trusted, which is correct on Vercel but spoofable on a self-hosted server unless a trusted proxy overwrites it. Rotating the cursor secret invalidates in-flight cursors (intended). Tests cover the origin/content-type gates, both limits, `Retry-After`, and cursor invalidation after secret rotation.

**Note (positive):** the handler's response handling is strong — strict request byte cap, strict JSON and shape validation, `Cache-Control: no-store`, and the secret never reaches the client bundle (`import "server-only"` plus a non-`NEXT_PUBLIC_` name).

### M4 — Secret residue in un-zeroizable JS strings

**Evidence:** `WalletService` zeroizes what it can — `seed.fill(0)` in `finally` blocks and `HDKey.wipePrivateData()` (`src/core/hd-wallet.ts`, driven from `src/services/wallet-service.ts`). But the same secrets also exist as immutable `string`s:

- `WalletService.pendingWallet.mnemonic` and `pendingWallet.privateKey`
- the `privateKeys: Map<number, Hex>` values
- the `privateKey` in React state (`src/components/reveal-private-key.tsx`)

JavaScript strings cannot be zeroized. `lock()` drops the references, but heap copies persist until garbage collection.

**Impact:** a heap snapshot, crash core dump, or attached debugger can recover a mnemonic or key that is believed to be cleared. Combined with M1's long unlock window, the exposure window is large.

**Status: mitigated, not eliminated.** This is a minimization pass, because V8 strings are immutable and cannot be zeroed once created:

- `src/core/secret.ts` — `secretToBytes` / `bytesToSecret` / `wipeBytes` / `wipeSecretMap`. Session keys now live in `privateKeys: Map<number, Uint8Array>` instead of hex strings, and every session end (`lock()`, wallet switch, account activation) overwrites each buffer with zeros before clearing the map.
- `pendingWallet` holds BIP-39 **entropy** (`Uint8Array`) instead of the phrase. The words are re-encoded only for the vault write, and the entropy is wiped on lock, on discard, and after a successful creation. `prepareWallet` wipes the entropy and seed on every failure path.
- Hex is produced only at the signing boundary (`signAndSendTransaction`, `signAndSendTokenTransfer`, `revokeAccountDelegation`) and for the explicit reveal screen, where viem/UI require it.
- `src/components/create-wallet-form.tsx` drops the phrase from React state immediately after creation; `src/components/reveal-private-key.tsx` drops the revealed key when the session locks or the route changes.

**Residual / accepted risk:** the hex strings created at the signing boundary, the `Hex` returned by `revealPrivateKey` (a user-requested disclosure), and the phrase returned to the setup screen for display still exist as immutable strings until garbage collection. `viem`/`@scure` also create internal hex copies. A heap dump or debugger attached to the tab can still find them; no pure-JavaScript wallet can promise otherwise. What improved is that the *long-lived* session state — the keys kept for the whole unlock window and the phrase kept during backup — is now zeroizable, which shrinks the window from "until lock" to "one signing call". The documentation and UI do not claim full memory erasure.

### M5 — Single trusted RPC

**Evidence:** `src/core/chain.ts` resolves one endpoint per chain (publicnode default, `NEXT_PUBLIC_RPC_URL_*` override) and `getPublicClient` caches one client per chain. That endpoint serves balances, nonce, gas price, EIP-7702 delegation reads (`eth_getCode`), and the transaction broadcast.

**Impact:** a malicious or compromised RPC can misreport balances, propose extreme gas prices (see L2), lie about delegation state on the account-abstraction screen, and censor transactions. This is inherent to a lightweight client.

**Remediation:** acknowledge in the README, keep the `NEXT_PUBLIC_RPC_URL_*` override as the documented mitigation, and consider allowing a user-configured endpoint.

---

## 4. Low severity

- **L1 — `data:image/svg+xml` accepted.** `isImageMediaType` in `src/core/url-safety.ts` is `startsWith("image/")`, so SVG is allowed. It renders via `<img>` in `src/components/nft-portfolio.tsx`, where SVG scripts do **not** execute, so this is **not XSS** — but it permits convincing fake-UI/phishing images and inflates `localStorage`. Consider an explicit raster allow-list (`image/png`, `image/jpeg`, `image/webp`, `image/gif`) or rejecting SVG.
- **L2 — Legacy `gasPrice`, no absolute fee cap.** `src/services/transaction-service.ts` used `getGasPrice` + `gas` rather than EIP-1559 fees, and passed reviewed values straight through with no hard ceiling. The review screen (`src/components/send-form.tsx`) showed the estimated fee, which limited the blast radius, but an attacker-controlled RPC could still propose an extreme price.

  **Status: mitigated, with documented residuals.** Transfers and EIP-7702 revokes now use `estimateFeesPerGas` and sign explicit `maxFeePerGas` / `maxPriorityFeePerGas` values; legacy `gasPrice` is no longer sent. `src/core/fees.ts` enforces hard ceilings on both fresh estimates and the reviewed snapshot: gas limit ≤ 1,000,000, max fee ≤ 1,000 gwei, priority fee ≤ 50 gwei (and ≤ max fee), and total maximum fee ≤ 0.1 native token. A partial review is rejected instead of re-estimating, so the signed numbers always match what was shown. The review screen displays gas limit, max fee per gas, priority fee, maximum network fee, and maximum total, and shows an amber warning at 100 gwei or 0.01 native. Residuals: the RPC still chooses the base-fee proposal and gas estimate within those ceilings; a hard cap can block a legitimate send during extreme congestion; OP/Base L1 data fees are charged on top of the displayed execution fee, as before; and the node requires the balance to cover the maximum fee, so an account that could afford only the actual fee may need more funds to send.
- **L3 — NFT metadata fetch follows redirects off the gateways.** `fetchNftJson` in `src/services/nft-service.ts` sets `redirect: "follow"` with no allow-list. `isPrivateHostname` blocks literal private hosts, but a public host can redirect elsewhere, and the fetch **leaks the user's IP address** to arbitrary metadata servers.

  **Status: mitigated, with a documented residual.** Gateways must be able to redirect (browsers do not expose intermediate `Location` headers for manual redirects), so the request still uses `redirect: "follow"`. What changed: the **final** `response.url` is validated with `parseSafeRemoteUrl`, so a redirect to a private host, loopback address, or cleartext HTTP is rejected before any metadata is parsed; requests now send `credentials: "omit"` and `referrerPolicy: "no-referrer"`. The residual is inherent to client-side NFT rendering: any metadata or image host still learns the user's IP address. Removing that requires proxying metadata **and** images through the server; a strict gateway allow-list was considered and rejected because it would break NFTs whose metadata is served from their own domain (and `connect-src https:` would have to be narrowed at the same time).

- **L4 — Untrusted provider error text reflected into the UI.** `assertNftOwned` appended `error.message`, and several services embedded upstream messages. React escapes them so there was no XSS, but untrusted text became user-visible — a phishing-adjacent surface.

  **Status: fixed.** Every service boundary that talks to an RPC, contract, or gateway now throws fixed local text and keeps the original error only as `cause` (never rendered): NFT metadata and ownership reads (`src/services/nft-service.ts`, `src/services/wallet-service.ts`), native and ERC-20 estimates/sends (`src/services/transaction-service.ts`), native balances (`src/services/balance-service.ts`), and EIP-7702 delegation reads/revokes (`src/services/account-abstraction-service.ts`). Known viem conditions are matched through the `cause` chain (`src/lib/errors.ts`) so the user still gets actionable wording for insufficient funds, timeouts, nonce races, and contract reverts — without repeating provider strings. The UI keeps rendering `error.message`, which is now a local service contract; tests assert the upstream marker does not appear in any user-visible message.
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
- **Test coverage.** 298 unit tests across 30 files, including crypto round-trip, wrong-password rejection, deterministic derivation, entropy round-trip, cursor-secret handling, route abuse controls, redirect validation, provider-text sanitation, and EIP-1559 fee caps.

---

## 7. Appendix — verification log

| Check | Result |
|---|---|
| `console.*` / `eval` / `innerHTML` in `src/` | None (one static `dangerouslySetInnerHTML` in `theme-script.tsx`, safe today) |
| `.env` tracked by git | No — ignored at `.gitignore:34`, never in history |
| Secrets in `localStorage` | Fixed — IndexedDB with one-time import of existing installs (H2) |
| Idle / auto-lock | Fixed — 30-second absolute deadline, visibility re-check, inactivity notice (M1) |
| Failed-unlock throttle | Fixed — 3rd failure starts a 30-second cooldown; advisory strength meter (M2) |
| History route abuse controls | Fixed — same-origin + JSON gate, 30/min per IP, 20/min per address, separate cursor secret (M3) |
| Session key storage | Mitigated — `Uint8Array` keys, zeroized on lock/switch; pending phrase held as entropy (M4) |
| Security headers | Present in production — verified by `curl -I` and a production browser pass (H1, phase 1) |
| History origin / content-type gate | Verified in dev — `403` for cross-site, `415` for non-JSON |
| History rate limit | Verified in dev — 31st request from one IP returns `429` with `Retry-After: 60` |
| History upstream | Etherscan timed out from the audit network; the sanitized `502` path was observed, success path covered by mocked tests |
| M4 runtime behavior | Verified in dev — wallet import works; revealed key disappears when the 30-second idle lock fires |
| `pnpm audit` | Failed — registry lacks the advisories endpoint (I1) |
| Runtime verification | Performed with `next-dev-loop` (`/_next/mcp` clean) plus `pnpm build` |
| Redirect validation | Covered by unit tests (live metadata hosts were not reachable from the audit network) |
| Provider-text sanitation | Verified in dev — an EOA NFT contract produced only the fixed "Could not verify NFT ownership…" message, with no provider text |
| EIP-1559 fee caps | Unit-tested; verified in dev that the review shows gas limit, max fee, priority fee, and maximum total |
| EIP-1559 broadcast | Verified on Base Sepolia — a type-2 transfer and a type-4 delegation revoke both confirmed with explicit `maxFeePerGas` / `maxPriorityFeePerGas` |

**Priority order for remediation:** ~~H1~~ → ~~H2 + M1~~ → ~~M2 + M3~~ → ~~M4 + L2 + L3 + L4~~ → M5 → L1 → L5 → I1.
