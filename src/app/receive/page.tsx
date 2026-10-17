import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { ReceiveAddress } from "@/components/receive-address";
import { WalletGuard } from "@/components/wallet-guard";

export default function ReceivePage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <Suspense fallback={null}>
          <ReceiveAddress />
        </Suspense>
      </WalletGuard>
    </>
  );
}
