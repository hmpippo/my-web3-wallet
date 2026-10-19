import { MnemonicImportForm } from "@/components/mnemonic-import-form";
import { SiteHeader } from "@/components/site-header";

export default function ImportPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main form-page">
        <MnemonicImportForm />
      </main>
    </>
  );
}
