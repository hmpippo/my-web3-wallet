import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeScript } from "@/components/theme-script";
import { WalletIdleLock } from "@/components/wallet-idle-lock";
import { WalletUnloadLock } from "@/components/wallet-unload-lock";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Wallet",
  description: "A self-custody EVM wallet, built for your device.",
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
        <WalletIdleLock />
        <WalletUnloadLock />
        {children}
      </body>
    </html>
  );
}
