import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeScript } from "@/components/theme-script";
import { WalletIdleLock } from "@/components/wallet-idle-lock";
import { WalletUnloadLock } from "@/components/wallet-unload-lock";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Wallet",
  description: "A self-custody EVM wallet, built for your device.",
  applicationName: "My Wallet",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "My Wallet",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    // Next emits the standard mobile-web-app-capable tag; older iOS versions
    // still look for the Apple-prefixed equivalent.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1310" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      data-theme={DEFAULT_THEME_MODE}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <ThemeScript />
        <PwaRegister />
        <WalletIdleLock />
        <WalletUnloadLock />
        {children}
      </body>
    </html>
  );
}
