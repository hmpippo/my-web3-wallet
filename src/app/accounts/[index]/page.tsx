import { SiteHeader } from "@/components/site-header";
import { AccountDetail } from "@/components/account-detail";
import { WalletGuard } from "@/components/wallet-guard";

export default function AccountDetailPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <AccountDetail />
      </WalletGuard>
    </>
  );
}
