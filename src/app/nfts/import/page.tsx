import { SiteHeader } from "@/components/site-header";
import { ImportNftForm } from "@/components/import-nft-form";
import { WalletGuard } from "@/components/wallet-guard";

export default function ImportNftPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <ImportNftForm />
      </WalletGuard>
    </>
  );
}
