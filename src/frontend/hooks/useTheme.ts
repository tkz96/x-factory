// src/frontend/hooks/useTheme.ts — Theme engine, Appearance (Automatic/Light/Dark), and Contrast levels (#248).
//
// One appearance for the whole app, held in a module store so every component
// that reads it (shell, Settings, diagrams) sees the same value. The settings
// object is the source of truth; browser storage only mirrors the choice so
// the pre-paint script in index.html can apply it before React loads. Every
// storage access is guarded: a failing storage never breaks the theme.

import { useEffect, useSyncExternalStore } from "react";
import type {
  AppearanceSetting,
  ContrastSetting,
  ResolvedAppearance,
} from "../../shared/types.js";

export type { AppearanceSetting, ContrastSetting, ResolvedAppearance };

const STORAGE_KEY = "xf_appearance";

export function resolveInitialAppearance(
  stored?: string | null | undefined,
): AppearanceSetting {
  if (stored === "light" || stored === "dark") return stored;
  return "automatic";
}

export function resolveAppearance(
  setting: AppearanceSetting,
  osPrefersDark: boolean,
): ResolvedAppearance {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  return osPrefersDark ? "dark" : "light";
}

export function resolveContrast(osPrefersContrast: boolean): ContrastSetting {
  return osPrefersContrast ? "more" : "standard";
}

function readStoredAppearance(): AppearanceSetting {
  try {
    return resolveInitialAppearance(
      globalThis.localStorage?.getItem(STORAGE_KEY),
    );
  } catch {
    return "automatic";
  }
}

function writeStoredAppearance(appearance: AppearanceSetting): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, appearance);
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

export interface ApplyThemeOptions {
  theme?: string | undefined;
  resolvedAppearance: ResolvedAppearance;
  contrast: ContrastSetting;
}

/** Sets the theme × appearance × contrast attributes the tokens key off. */
export function applyThemeToDocument(options: ApplyThemeOptions): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", options.theme ?? "default");
  root.setAttribute("data-appearance", options.resolvedAppearance);
  root.setAttribute("data-contrast", options.contrast);
}

let currentAppearance: AppearanceSetting = readStoredAppearance();
const listeners = new Set<() => void>();

function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes the app's appearance everywhere at once and mirrors it to storage. */
export function setAppearance(next: AppearanceSetting): void {
  const appearance = resolveInitialAppearance(next);
  writeStoredAppearance(appearance);
  if (appearance === currentAppearance) return;
  currentAppearance = appearance;
  for (const listener of listeners) listener();
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

export function useTheme() {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    () => currentAppearance,
    () => currentAppearance,
  );
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const prefersContrast = useMediaQuery("(prefers-contrast: more)");

  const resolvedAppearance = resolveAppearance(appearance, prefersDark);
  const contrast = resolveContrast(prefersContrast);

  useEffect(() => {
    applyThemeToDocument({ resolvedAppearance, contrast });
  }, [resolvedAppearance, contrast]);

  /** Flips between Light and Dark from whatever is showing now. */
  const toggleTheme = (): AppearanceSetting => {
    const next = resolvedAppearance === "light" ? "dark" : "light";
    setAppearance(next);
    return next;
  };

  return {
    appearance,
    resolvedAppearance,
    contrast,
    setAppearance,
    toggleTheme,
  };
}
