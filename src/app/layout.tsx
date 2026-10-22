import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "@/components/pwa-register";
import { WalletIdleLock } from "@/components/wallet-idle-lock";
import { WalletUnloadLock } from "@/components/wallet-unload-lock";
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
  themeColor: "#0b1310",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html data-theme="dark" lang="en">
      <body>
        <PwaRegister />
        <WalletIdleLock />
        <WalletUnloadLock />
        {children}
      </body>
    </html>
  );
}
