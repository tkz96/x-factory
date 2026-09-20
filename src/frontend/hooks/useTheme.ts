// src/frontend/hooks/useTheme.ts — Centralized theme state and localStorage synchronization.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function resolveInitialTheme(
  storedTheme?: string | null | undefined,
  prefersLight?: boolean | undefined,
): Theme {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return prefersLight ? "light" : "dark";
}

export function applyThemeToDocument(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("xf_theme", theme);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem("xf_theme") : null;
    const prefersLight =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
        : false;
    return resolveInitialTheme(stored, prefersLight);
  });

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const applyTheme = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return {
    theme,
    setTheme,
    applyTheme,
    toggleTheme,
  };
}
