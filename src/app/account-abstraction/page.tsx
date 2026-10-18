import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { AccountAbstraction } from "@/components/account-abstraction";
import { WalletGuard } from "@/components/wallet-guard";

export default function AccountAbstractionPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <Suspense fallback={null}>
          <AccountAbstraction />
        </Suspense>
      </WalletGuard>
    </>
  );
}
