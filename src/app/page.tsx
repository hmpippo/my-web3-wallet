import { SiteHeader } from "@/components/site-header";
import Link from "next/link";

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

        <section className="setup-panel" aria-labelledby="start-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Get started</p>
              <h2 id="start-title">Choose how to begin</h2>
            </div>
            <span className="preview-label">Self-custody</span>
          </div>

          <div className="setup-options">
            <article className="setup-option">
                <span className="option-number">01</span>
                <div>
                  <h3>Create a wallet</h3>
                  <p>
                    Generate a recovery phrase and protect it with a password.
                  </p>
                </div>
                <Link className="button button-primary" href="/create">
                  Create wallet
                </Link>
            </article>
            <article className="setup-option">
              <span className="option-number">02</span>
              <div>
                <h3>Import a wallet</h3>
                <p>Restore your wallet from a 12 or 24-word recovery phrase.</p>
              </div>
              <Link className="button button-outline" href="/import">
                Import wallet
              </Link>
            </article>
          </div>

          <div className="returning-user">
            <p>Already set up on this device?</p>
            <Link className="text-link" href="/unlock">
              Unlock wallet <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <aside className="preview-note">
          <span className="status-dot" aria-hidden="true" />
          <p>
            Switch networks from the header. Testnet funds have no real value;
            on mainnets you are moving real assets. Never enter a recovery
            phrase you use for real funds.
          </p>
        </aside>
      </main>
    </>
  );
}
