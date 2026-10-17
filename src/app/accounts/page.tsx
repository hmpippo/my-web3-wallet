import { SiteHeader } from "@/components/site-header";
import { ManageAccounts } from "@/components/manage-accounts";
import { WalletGuard } from "@/components/wallet-guard";

export default function AccountsPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <ManageAccounts />
      </WalletGuard>
    </>
  );
}
