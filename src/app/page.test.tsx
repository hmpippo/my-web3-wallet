import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import Home from "./page";

describe("home page shell", () => {
  it("offers the create and import choices for a device with no wallets", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain("Create a wallet");
    expect(markup).toContain("Import a wallet");
    expect(markup).toContain("Create wallet");
    expect(markup).toContain("Import wallet");
    expect(markup).toContain(
      "Never enter a recovery phrase you use for real funds.",
    );
  });
});
