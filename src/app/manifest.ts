import type { MetadataRoute } from "next";

/**
 * Install metadata for the wallet. This is deliberately static: the installed
 * app shell does not depend on the user's current chain.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "My Wallet",
    short_name: "Wallet",
    description: "A self-custody EVM wallet, built for your device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1310",
    theme_color: "#0b1310",
    lang: "en",
    dir: "ltr",
    categories: ["finance", "utilities"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
