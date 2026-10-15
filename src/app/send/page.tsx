import { SiteHeader } from "@/components/site-header";

export default function SendPage() {
  return (
    <>
      <SiteHeader />
      <main className="page-main">
        <section className="page-heading">
          <p className="eyebrow">Transfer</p>
          <h1>Send ETH</h1>
          <p>
            The transaction flow will be connected after wallet and chain
            services are implemented.
          </p>
        </section>

        <section aria-label="Send form preview" className="preview-card">
          <p className="muted-copy">
            This form is a non-functional layout preview. No transaction can be
            prepared or sent.
          </p>
          <form className="send-fields">
            <label>
              Recipient address
              <input
                autoComplete="off"
                disabled
                placeholder="0x..."
                type="text"
              />
            </label>
            <label>
              Amount
              <input
                disabled
                inputMode="decimal"
                placeholder="0.00"
                type="text"
              />
            </label>
            <button className="button" disabled type="button">
              Send unavailable
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
