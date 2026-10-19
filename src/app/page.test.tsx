import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import Home from "./page";

describe("home page shell", () => {
  it("offers the create, import, and private-key choices for a device with no wallets", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain("Create wallet");
    expect(markup).toContain("Import wallet");
    expect(markup).toContain("Import private key");
    // No device wallets means no wallet cards, only the actions.
    expect(markup).not.toContain("Your wallets");
    expect(markup).not.toContain("Imported accounts");
    expect(markup).toContain(
      "Never enter a recovery phrase you use for real funds.",
    );
  });
});
