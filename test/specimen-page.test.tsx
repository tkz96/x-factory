// test/specimen-page.test.tsx — the dev-only specimen page renders every section
// once its route has loaded (spec #292, step 2, #294).

import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { specimenRoute } from "../src/frontend/dev-routes.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

describe("the specimen page", () => {
  it("switches settings and opens every overlay it shows", async () => {
    const view = render(<MemoryRouter>{specimenRoute().element}</MemoryRouter>);
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Overlays" })).toBeTruthy(),
    );
    fireEvent.click(view.getByRole("radio", { name: "Dark" }));
    fireEvent.click(view.getByRole("radio", { name: "Increase" }));
    fireEvent.click(view.getByRole("radio", { name: "On" }));
    fireEvent.click(view.getByText("Readable font"));
    expect(document.documentElement.getAttribute("data-font")).toBe("readable");
    fireEvent.click(view.getByRole("radio", { name: /^All/ }));
    fireEvent.click(view.getByRole("radio", { name: /^Active/ }));
    fireEvent.click(view.getByRole("radio", { name: "Done" }));
    fireEvent.click(view.getByText("Notify me"));
    fireEvent.click(view.getByRole("button", { name: "Open dialog…" }));
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    fireEvent.click(view.getByRole("button", { name: "Open sheet…" }));
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(view.getByRole("button", { name: "Open bottom sheet…" }));
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(view.getByRole("button", { name: "Delete Run…" }));
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    fireEvent.click(view.getByRole("button", { name: "Delete Run…" }));
    fireEvent.click(view.getByRole("button", { name: "Delete Run" }));
    fireEvent.click(view.getByRole("button", { name: "Run actions" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Open Run" }));
    fireEvent.focus(view.getByRole("button", { name: "Hover for tooltip" }));
  });

  it("renders every section once its route loads", async () => {
    // Queries are bound to the render result: `screen` binds to document at import,
    // before the DOM is registered.
    const view = render(<MemoryRouter>{specimenRoute().element}</MemoryRouter>);
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "Specimen" })).toBeTruthy(),
    );
    for (const name of [
      "Switches",
      "Blocks",
      "Overlays",
      "Type scale",
      "Corners",
    ]) {
      expect(view.getByRole("heading", { name })).toBeTruthy();
    }
  });
});
