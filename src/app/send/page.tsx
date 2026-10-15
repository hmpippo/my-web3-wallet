import { SiteHeader } from "@/components/site-header";
import { SendForm } from "@/components/send-form";
import { WalletGuard } from "@/components/wallet-guard";

export default function SendPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <SendForm />
      </WalletGuard>
    </>
  );
}
