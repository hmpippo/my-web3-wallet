import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy.
 *
 * Next.js App Router streams RSC data through inline `self.__next_f.push(...)`
 * scripts whose content changes per page, so a hash-only `script-src` cannot
 * work. This policy therefore allows `'unsafe-inline'` for scripts and focuses
 * on what it can still enforce: no external script origins, no `eval`, no
 * plugins/objects, no framing, no form exfiltration, and restricted
 * connect/image destinations.
 *
 * A stricter nonce-based policy would require `middleware.ts` and force every
 * route to render dynamically, so it is tracked separately.
 *
 * `connect-src https:` is broad because NFT metadata may be fetched from any
 * public HTTPS host (`src/services/nft-service.ts`). It stops `http:`, `ws:`,
 * and non-HTTPS exfiltration, but not exfiltration to an arbitrary HTTPS
 * endpoint. Tightening this depends on restricting NFT metadata to an
 * allow-list of gateways.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // Turbopack's dev overlay and HMR evaluation need 'unsafe-eval'.
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Inline "data:" images are legitimate NFT art; "https:" is required because
  // metadata can point at any public host.
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  // Dev needs the HMR websocket. "self" covers /api/transactions.
  isDev
    ? "connect-src 'self' https: ws: wss:"
    : "connect-src 'self' https:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Both are set: frame-ancestors for modern browsers, X-Frame-Options for
  // older ones. The wallet must never be framed (clickjacking of Send/Revoke).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // Vercel sets this too; keeping it makes a self-hosted deployment correct.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // publickey-credentials-* must stay enabled or biometric unlock breaks
  // (src/core/webauthn.ts uses navigator.credentials). camera is limited to
  // this origin for the recipient QR scanner on the Send page; microphone and
  // geolocation stay disabled.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)",
  },
];

const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The browser must revalidate the worker so a deployment can replace
        // the cached app shell without serving an old script indefinitely.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/offline.html",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
