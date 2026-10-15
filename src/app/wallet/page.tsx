import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function WalletPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main">
        <section className="page-heading">
          <p className="eyebrow">Wallet overview</p>
          <h1>Good to see you.</h1>
          <p>
            Your account address and on-chain balance will appear here after the
            wallet core is connected.
          </p>
        </section>

        <section aria-labelledby="balance-heading" className="preview-card">
          <h2 id="balance-heading">Available balance</h2>
          <p aria-label="Balance unavailable" className="balance-placeholder">
            -- ETH
          </p>
          <p className="muted-copy">
            No wallet is connected. This preview does not read or display
            account data.
          </p>
          <Link className="button" href="/send">
            Preview send screen
          </Link>
        </section>
      </main>
    </>
  );
}
