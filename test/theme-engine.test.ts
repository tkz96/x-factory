// test/theme-engine.test.ts — Unit tests for Theme Engine, Appearance setting, and Contrast detection (#248).

import { describe, expect, it } from "bun:test";
import {
  applyThemeToDocument,
  resolveAppearance,
  resolveContrast,
  resolveInitialAppearance,
} from "../src/frontend/hooks/useTheme.js";

describe("Theme Engine (useTheme) — Resolution & Attributes", () => {
  it("defaults appearance to Automatic if none stored", () => {
    expect(resolveInitialAppearance(null)).toBe("automatic");
    expect(resolveInitialAppearance(undefined)).toBe("automatic");
    expect(resolveInitialAppearance("invalid")).toBe("automatic");
  });

  it("resolves stored explicit appearance values", () => {
    expect(resolveInitialAppearance("light")).toBe("light");
    expect(resolveInitialAppearance("dark")).toBe("dark");
    expect(resolveInitialAppearance("automatic")).toBe("automatic");
    expect(resolveInitialAppearance("auto")).toBe("automatic");
    // The old xf_theme key held whatever was showing, not a choice; it is never read.
  });

  it("resolves Automatic appearance according to OS prefers-color-scheme", () => {
    expect(resolveAppearance("automatic", false)).toBe("light");
    expect(resolveAppearance("automatic", true)).toBe("dark");
    expect(resolveAppearance("auto", false)).toBe("light");
    expect(resolveAppearance("auto", true)).toBe("dark");
  });

  it("explicit light and dark overrides OS prefers-color-scheme", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("light", false)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
    expect(resolveAppearance("dark", true)).toBe("dark");
  });

  it("resolves contrast from OS prefers-contrast", () => {
    expect(resolveContrast(false)).toBe("standard");
    expect(resolveContrast(true)).toBe("more");
  });

  it("applies theme, appearance, and contrast data attributes to document root", () => {
    const mockStorage: Record<string, string> = {};
    const mockElement = {
      attributes: {} as Record<string, string>,
      setAttribute(key: string, val: string) {
        this.attributes[key] = val;
      },
      removeAttribute(key: string) {
        delete this.attributes[key];
      },
    };

    const originalDoc = (globalThis as Record<string, unknown>).document;
    const originalStorage = (globalThis as Record<string, unknown>)
      .localStorage;

    try {
      (
        globalThis as unknown as {
          document: { documentElement: typeof mockElement };
        }
      ).document = { documentElement: mockElement };
      (
        globalThis as unknown as {
          localStorage: { setItem: (k: string, v: string) => void };
        }
      ).localStorage = {
        setItem(k: string, v: string) {
          mockStorage[k] = v;
        },
      };

      applyThemeToDocument({
        theme: "default",
        resolvedAppearance: "light",
        contrast: "standard",
      });

      expect(mockElement.attributes["data-theme"]).toBe("default");
      expect(mockElement.attributes["data-appearance"]).toBe("light");
      expect(mockElement.attributes["data-contrast"]).toBe("standard");

      // With increased contrast and dark appearance
      applyThemeToDocument({
        theme: "default",
        resolvedAppearance: "dark",
        contrast: "more",
      });

      expect(mockElement.attributes["data-theme"]).toBe("default");
      expect(mockElement.attributes["data-appearance"]).toBe("dark");
      expect(mockElement.attributes["data-contrast"]).toBe("more");
    } finally {
      if (originalDoc === undefined) {
        delete (globalThis as Record<string, unknown>).document;
      } else {
        (globalThis as Record<string, unknown>).document = originalDoc;
      }
      if (originalStorage === undefined) {
        delete (globalThis as Record<string, unknown>).localStorage;
      } else {
        (globalThis as Record<string, unknown>).localStorage = originalStorage;
      }
    }
  });
});
