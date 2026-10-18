import { SiteHeader } from "@/components/site-header";
import { RevealPrivateKey } from "@/components/reveal-private-key";
import { WalletGuard } from "@/components/wallet-guard";

export default function PrivateKeyPage() {
  return (
    <>
      <SiteHeader />
      <WalletGuard>
        <RevealPrivateKey />
      </WalletGuard>
    </>
  );
}
