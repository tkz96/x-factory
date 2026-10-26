// test/theme-accessibility-settings.test.ts — Unit tests for the Readable font and
// Reduce Transparency settings (spec #292): attribute resolution and the attributes
// applyThemeToDocument writes to the root element.

import { describe, expect, it } from "bun:test";
import {
  applyThemeToDocument,
  resolveReadableFont,
  resolveTransparency,
  resolveTransparencyAttribute,
} from "../src/frontend/hooks/useTheme.js";

function withMockDocument(run: (attributes: Record<string, string>) => void) {
  const attributes: Record<string, string> = {};
  const originalDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
      removeAttribute: (name: string) => {
        delete attributes[name];
      },
    },
  };
  try {
    run(attributes);
  } finally {
    if (originalDoc === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = originalDoc;
    }
  }
}

describe("Reduce Transparency setting (spec #292)", () => {
  it("stored values resolve to automatic, reduced or full; anything else is automatic", () => {
    expect(resolveTransparency(null)).toBe("automatic");
    expect(resolveTransparency(undefined)).toBe("automatic");
    expect(resolveTransparency("")).toBe("automatic");
    expect(resolveTransparency("bogus")).toBe("automatic");
    expect(resolveTransparency("reduced")).toBe("reduced");
    expect(resolveTransparency("full")).toBe("full");
  });

  it("On and Off ignore the OS setting", () => {
    expect(resolveTransparencyAttribute("reduced", false)).toBe("reduced");
    expect(resolveTransparencyAttribute("reduced", true)).toBe("reduced");
    expect(resolveTransparencyAttribute("full", false)).toBe("full");
    expect(resolveTransparencyAttribute("full", true)).toBe("full");
  });

  it("Automatic follows (prefers-reduced-transparency: reduce)", () => {
    expect(resolveTransparencyAttribute("automatic", true)).toBe("reduced");
    expect(resolveTransparencyAttribute("automatic", false)).toBe("full");
  });

  it("writes data-transparency on the root element for each resolved value", () => {
    withMockDocument((attributes) => {
      applyThemeToDocument({
        resolvedAppearance: "light",
        contrast: "standard",
        transparency: resolveTransparencyAttribute("automatic", true),
      });
      expect(attributes["data-transparency"]).toBe("reduced");

      applyThemeToDocument({
        resolvedAppearance: "light",
        contrast: "standard",
        transparency: resolveTransparencyAttribute("full", true),
      });
      expect(attributes["data-transparency"]).toBe("full");

      applyThemeToDocument({
        resolvedAppearance: "light",
        contrast: "standard",
      });
      expect(attributes["data-transparency"]).toBeUndefined();
    });
  });
});

describe("Readable font setting (spec #292)", () => {
  it("is off unless the stored value is exactly 'true'", () => {
    expect(resolveReadableFont(null)).toBe(false);
    expect(resolveReadableFont(undefined)).toBe(false);
    expect(resolveReadableFont("false")).toBe(false);
    expect(resolveReadableFont("1")).toBe(false);
    expect(resolveReadableFont("true")).toBe(true);
  });

  it("sets data-font=readable on the root element only when on", () => {
    withMockDocument((attributes) => {
      applyThemeToDocument({
        resolvedAppearance: "dark",
        contrast: "more",
        readableFont: true,
      });
      expect(attributes["data-font"]).toBe("readable");
      expect(attributes["data-contrast"]).toBe("more");

      applyThemeToDocument({
        resolvedAppearance: "dark",
        contrast: "more",
        readableFont: false,
      });
      expect(attributes["data-font"]).toBeUndefined();
    });
  });
});
