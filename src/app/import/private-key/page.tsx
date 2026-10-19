import { PrivateKeyImportForm } from "@/components/private-key-import-form";
import { SiteHeader } from "@/components/site-header";

export default function ImportPrivateKeyPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main form-page">
        <PrivateKeyImportForm />
      </main>
    </>
  );
}
