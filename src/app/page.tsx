import { SiteHeader } from "@/components/site-header";
import { WalletManager } from "@/components/wallet-manager";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="page-main">
        <section className="hero" aria-labelledby="welcome-title">
          <p className="eyebrow">A wallet that stays yours</p>
          <h1 id="welcome-title">
            Your keys.
            <br />
            Your <span>control.</span>
          </h1>
          <p className="hero-copy">
            A simple EVM wallet interface, designed around local self-custody.
          </p>
        </section>

        <WalletManager />
      </main>
    </>
  );
}
