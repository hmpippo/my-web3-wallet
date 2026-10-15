import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const setupOptions = [
  {
    number: "01",
    title: "Create a wallet",
    description:
      "Generate a new wallet and protect it with a password. Backup confirmation will be part of setup.",
  },
  {
    number: "02",
    title: "Import a wallet",
    description:
      "Restore an existing wallet from its recovery phrase on this device.",
  },
];

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
            <span className="preview-label">Setup coming soon</span>
          </div>

          <div className="setup-options">
            {setupOptions.map((option) => (
              <article className="setup-option" key={option.number}>
                <span className="option-number">{option.number}</span>
                <div>
                  <h3>{option.title}</h3>
                  <p>{option.description}</p>
                </div>
                <button className="button button-muted" disabled type="button">
                  Not available yet
                </button>
              </article>
            ))}
          </div>

          <div className="returning-user">
            <p>Already set up on this device?</p>
            <button className="text-button" disabled type="button">
              Unlock wallet <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        <aside className="preview-note">
          <span className="status-dot" aria-hidden="true" />
          <p>
            This project is a UI skeleton. No wallet is created, stored, or
            unlocked yet.
          </p>
          <Link href="/wallet">View wallet preview</Link>
        </aside>
      </main>
    </>
  );
}
