import { SiteHeader } from "@/components/site-header";
import { ImportTokenForm } from "@/components/import-token-form";
import { WalletGuard } from "@/components/wallet-guard";

export default function ImportTokenPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <ImportTokenForm />
      </WalletGuard>
    </>
  );
}
