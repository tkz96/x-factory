// test/frontend-theme.test.ts — Unit tests for theme resolution, persistence, and state management.

import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  applyThemeToDocument,
  resolveInitialTheme,
  useTheme,
} from "../src/frontend/hooks/useTheme.js";

describe("Theme Architecture & Persistence (useTheme)", () => {
  it("resolves stored theme when valid light/dark value is present", () => {
    expect(resolveInitialTheme("light", false)).toBe("light");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
  });

  it("falls back to media query preference when stored theme is absent or invalid", () => {
    expect(resolveInitialTheme(null, true)).toBe("light");
    expect(resolveInitialTheme(null, false)).toBe("dark");
    expect(resolveInitialTheme(undefined, true)).toBe("light");
    expect(resolveInitialTheme(undefined, false)).toBe("dark");
    expect(resolveInitialTheme("invalid-theme", true)).toBe("light");
    expect(resolveInitialTheme("invalid-theme", false)).toBe("dark");
  });

  it("applies theme to global document and localStorage if environments are present", () => {
    // Mock minimal document and localStorage
    const mockStorage: Record<string, string> = {};
    const mockElement = {
      attributes: {} as Record<string, string>,
      setAttribute(key: string, val: string) {
        this.attributes[key] = val;
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
      ).document = {
        documentElement: mockElement,
      };
      (
        globalThis as unknown as {
          localStorage: { setItem: (k: string, v: string) => void };
        }
      ).localStorage = {
        setItem(k: string, v: string) {
          mockStorage[k] = v;
        },
      };

      applyThemeToDocument("light");
      expect(mockElement.attributes["data-theme"]).toBe("light");
      expect(mockStorage.xf_theme).toBe("light");

      applyThemeToDocument("dark");
      expect(mockElement.attributes["data-theme"]).toBe("dark");
      expect(mockStorage.xf_theme).toBe("dark");
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

  it("renders within a React component and initializes theme", () => {
    let executed = false;
    function Consumer() {
      const { theme, toggleTheme, applyTheme } = useTheme();
      if (!executed) {
        executed = true;
        applyTheme("light");
        toggleTheme();
      }
      return React.createElement("div", { id: "theme-val" }, theme);
    }

    const html = renderToString(React.createElement(Consumer));
    expect(html).toContain('id="theme-val"');
  });
});
