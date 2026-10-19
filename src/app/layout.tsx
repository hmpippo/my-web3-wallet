import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeScript } from "@/components/theme-script";
import { WalletUnloadLock } from "@/components/wallet-unload-lock";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Wallet",
  description: "A self-custody EVM wallet, built for your device.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeScript />
        <WalletUnloadLock />
        {children}
      </body>
    </html>
  );
}
