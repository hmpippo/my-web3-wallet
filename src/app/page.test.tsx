import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("home page shell", () => {
  it("shows the entry choices and makes clear setup is not implemented", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain("Create a wallet");
    expect(markup).toContain("Import a wallet");
    expect(markup).toContain("Unlock wallet");
    expect(markup).toContain("Create wallet");
    expect(markup).toContain("Import wallet");
    expect(markup).toContain("Never enter a recovery phrase you use for real funds.");
  });
});
