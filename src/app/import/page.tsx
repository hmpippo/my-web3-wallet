import { ImportWalletForm } from "@/components/import-wallet-form";
import { SiteHeader } from "@/components/site-header";

export default function ImportPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main form-page">
        <ImportWalletForm />
      </main>
    </>
  );
}
