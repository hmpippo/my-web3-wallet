"use client";

import { useState } from "react";
import { MnemonicImportForm } from "@/components/mnemonic-import-form";
import { PrivateKeyImportForm } from "@/components/private-key-import-form";

type ImportMethod = "mnemonic" | "privateKey";

const IMPORT_TABS: { method: ImportMethod; label: string }[] = [
  { method: "mnemonic", label: "Recovery phrase" },
  { method: "privateKey", label: "Private key" },
];

/**
 * Import entry point with a switch between the two supported secrets. The
 * selected method's form is mounted alone, so switching tabs drops any typed
 * secret from memory.
 */
export function ImportWalletForm() {
  const [method, setMethod] = useState<ImportMethod>("mnemonic");

  return (
    <section className="form-card" aria-labelledby="import-title">
      <p className="eyebrow">Restore wallet</p>
      <h1 id="import-title">Import a wallet</h1>

      <div className="history-tabs" role="tablist" aria-label="Import method">
        {IMPORT_TABS.map((tab) => (
          <button
            aria-controls={`import-panel-${tab.method}`}
            aria-selected={method === tab.method}
            className="history-tab"
            id={`import-tab-${tab.method}`}
            key={tab.method}
            onClick={() => setMethod(tab.method)}
            role="tab"
            tabIndex={method === tab.method ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`import-tab-${method}`}
        className="history-tabpanel"
        id={`import-panel-${method}`}
        role="tabpanel"
      >
        {method === "mnemonic" ? (
          <MnemonicImportForm />
        ) : (
          <PrivateKeyImportForm />
        )}
      </div>
    </section>
  );
}
