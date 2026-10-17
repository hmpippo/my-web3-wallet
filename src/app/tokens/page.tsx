import { SiteHeader } from "@/components/site-header";
import { ManageTokens } from "@/components/manage-tokens";
import { WalletGuard } from "@/components/wallet-guard";

export default function TokensPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <ManageTokens />
      </WalletGuard>
    </>
  );
}
