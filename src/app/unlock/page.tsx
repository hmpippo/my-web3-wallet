import { SiteHeader } from "@/components/site-header";
import { UnlockWalletForm } from "@/components/unlock-wallet-form";

export default function UnlockPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main form-page">
        <UnlockWalletForm />
      </main>
    </>
  );
}
