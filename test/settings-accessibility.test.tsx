// test/settings-accessibility.test.tsx — Settings → Accessibility controls (spec #292).
// Toggling the Readable font switch and each Reduce transparency choice stores the
// setting and sets data-font / data-transparency on the root element.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import { AccessibilitySettings } from "../src/frontend/components/settings/AccessibilitySettings.js";

afterAll(async () => {
  await unregisterHappyDom();
});

describe("Settings → Accessibility (spec #292)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-font");
    document.documentElement.removeAttribute("data-transparency");
  });

  afterEach(() => {
    cleanup();
  });

  it("the Readable font switch stores the choice and sets data-font on the root", () => {
    const { getByRole } = render(createElement(AccessibilitySettings));
    const readable = getByRole("switch", { name: "Readable font" });
    expect((readable as HTMLInputElement).checked).toBe(false);

    fireEvent.click(readable);
    expect(localStorage.getItem("xf_readable_font")).toBe("true");
    expect(document.documentElement.getAttribute("data-font")).toBe("readable");

    fireEvent.click(getByRole("switch", { name: "Readable font" }));
    expect(localStorage.getItem("xf_readable_font")).toBe("false");
    expect(document.documentElement.hasAttribute("data-font")).toBe(false);
  });

  it("each Reduce transparency choice stores the setting and sets data-transparency", () => {
    const { getByRole } = render(createElement(AccessibilitySettings));
    const group = getByRole("radiogroup", { name: "Reduce transparency" });
    expect(
      within(group).getByRole("radio", {
        name: "Reduce transparency: Automatic",
      }),
    ).toBeDefined();

    // On: opaque chrome, stored as "reduced".
    fireEvent.click(getByRole("radio", { name: "Reduce transparency: On" }));
    expect(localStorage.getItem("xf_transparency")).toBe("reduced");
    expect(document.documentElement.getAttribute("data-transparency")).toBe(
      "reduced",
    );

    // Off: glass, stored as "full".
    fireEvent.click(getByRole("radio", { name: "Reduce transparency: Off" }));
    expect(localStorage.getItem("xf_transparency")).toBe("full");
    expect(document.documentElement.getAttribute("data-transparency")).toBe(
      "full",
    );

    // Automatic: stored as "automatic"; the root takes the resolved value, which
    // follows the OS query. happy-dom has no reduced-transparency media, so glass.
    fireEvent.click(
      getByRole("radio", { name: "Reduce transparency: Automatic" }),
    );
    expect(localStorage.getItem("xf_transparency")).toBe("automatic");
    expect(document.documentElement.getAttribute("data-transparency")).toBe(
      "full",
    );
  });
});
