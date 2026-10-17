import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { SendForm } from "@/components/send-form";
import { WalletGuard } from "@/components/wallet-guard";

export default function SendPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <Suspense fallback={null}>
          <SendForm />
        </Suspense>
      </WalletGuard>
    </>
  );
}
