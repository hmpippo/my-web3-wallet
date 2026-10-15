import { SiteHeader } from "@/components/site-header";
import { WalletDashboard } from "@/components/wallet-dashboard";
import { WalletGuard } from "@/components/wallet-guard";

export default function WalletPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <WalletDashboard />
      </WalletGuard>
    </>
  );
}
