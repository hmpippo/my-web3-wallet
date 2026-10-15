import { CreateWalletForm } from "@/components/create-wallet-form";
import { SiteHeader } from "@/components/site-header";

export default function CreatePage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main form-page">
        <CreateWalletForm />
      </main>
    </>
  );
}
