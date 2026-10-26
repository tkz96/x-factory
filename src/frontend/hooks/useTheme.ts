// src/frontend/hooks/useTheme.ts — Theme engine, Appearance (Automatic/Light/Dark), Contrast levels,
// Readable Font, and Reduce Transparency accessibility settings (#248, spec #292).
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
  ThemeName,
} from "../../shared/types.js";

export type {
  AppearanceSetting,
  ContrastSetting,
  ResolvedAppearance,
  ThemeName,
};

const STORAGE_KEY = "xf_appearance";
// The Theme choice (#249) mirrors the settings object like Appearance does, under
// its own key: the old xf_theme key held what was showing, not a choice.
const THEME_STORAGE_KEY = "xf_theme_choice";
const THEME_NAMES: readonly ThemeName[] = ["default", "graphite", "sandstone"];

/** Reduce Transparency setting (spec #292). */
export type TransparencySetting = "automatic" | "reduced" | "full";
/** Readable Font setting (spec #292). */
export type ReadableFontSetting = boolean;

const TRANSPARENCY_STORAGE_KEY = "xf_transparency";
const READABLE_FONT_STORAGE_KEY = "xf_readable_font";

export function resolveInitialTheme(
  stored?: string | null | undefined,
): ThemeName {
  return THEME_NAMES.find((name) => name === stored) ?? "default";
}

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

/** Resolve the transparency setting. Automatic defers to the OS media query;
 *  On forces reduced; Off forces full glass. */
export function resolveTransparency(
  stored?: string | null | undefined,
): TransparencySetting {
  if (stored === "reduced" || stored === "full") return stored;
  return "automatic";
}

/** Resolve the readable-font setting from a stored string. */
export function resolveReadableFont(
  stored?: string | null | undefined,
): ReadableFontSetting {
  return stored === "true";
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

function readStoredTheme(): ThemeName {
  try {
    return resolveInitialTheme(
      globalThis.localStorage?.getItem(THEME_STORAGE_KEY),
    );
  } catch {
    return "default";
  }
}

function writeStoredTheme(theme: ThemeName): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

function readStoredTransparency(): TransparencySetting {
  try {
    return resolveTransparency(
      globalThis.localStorage?.getItem(TRANSPARENCY_STORAGE_KEY),
    );
  } catch {
    return "automatic";
  }
}

function writeStoredTransparency(transparency: TransparencySetting): void {
  try {
    globalThis.localStorage?.setItem(TRANSPARENCY_STORAGE_KEY, transparency);
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

function readStoredReadableFont(): ReadableFontSetting {
  try {
    return resolveReadableFont(
      globalThis.localStorage?.getItem(READABLE_FONT_STORAGE_KEY),
    );
  } catch {
    return false;
  }
}

function writeStoredReadableFont(enabled: ReadableFontSetting): void {
  try {
    globalThis.localStorage?.setItem(
      READABLE_FONT_STORAGE_KEY,
      String(enabled),
    );
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

export interface ApplyThemeOptions {
  theme?: string | undefined;
  resolvedAppearance: ResolvedAppearance;
  contrast: ContrastSetting;
  transparency?: TransparencySetting | undefined;
  readableFont?: ReadableFontSetting | undefined;
}

/** Sets the theme × appearance × contrast attributes the tokens key off.
 *  Also applies data-transparency and data-font attributes (spec #292). */
export function applyThemeToDocument(options: ApplyThemeOptions): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", options.theme ?? "default");
  root.setAttribute("data-appearance", options.resolvedAppearance);
  root.setAttribute("data-contrast", options.contrast);
  // Transparency: only set the attribute when not automatic so the CSS media
  // query fallback (@media prefers-reduced-transparency) can apply.
  if (options.transparency && options.transparency !== "automatic") {
    root.setAttribute("data-transparency", options.transparency);
  } else {
    root.removeAttribute("data-transparency");
  }
  // Readable font: set data-font="readable" when on, remove otherwise.
  if (options.readableFont) {
    root.setAttribute("data-font", "readable");
  } else {
    root.removeAttribute("data-font");
  }
}

let currentAppearance: AppearanceSetting = readStoredAppearance();
let currentTheme: ThemeName = readStoredTheme();
let currentTransparency: TransparencySetting = readStoredTransparency();
let currentReadableFont: ReadableFontSetting = readStoredReadableFont();
const listeners = new Set<() => void>();
function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes the visual theme everywhere at once and mirrors it to storage (#249). */
export function setTheme(next: ThemeName): void {
  const theme = resolveInitialTheme(next);
  writeStoredTheme(theme);
  if (theme === currentTheme) return;
  currentTheme = theme;
  for (const listener of listeners) listener();
}

/** Changes the app's appearance everywhere at once and mirrors it to storage. */
export function setAppearance(next: AppearanceSetting): void {
  const appearance = resolveInitialAppearance(next);
  writeStoredAppearance(appearance);
  if (appearance === currentAppearance) return;
  currentAppearance = appearance;
  for (const listener of listeners) listener();
}

/** Changes the Reduce Transparency setting and mirrors it to storage (spec #292). */
export function setTransparency(next: TransparencySetting): void {
  writeStoredTransparency(next);
  if (next === currentTransparency) return;
  currentTransparency = next;
  for (const listener of listeners) listener();
}

/** Toggles the Readable Font setting and mirrors it to storage (spec #292). */
export function setReadableFont(next: ReadableFontSetting): void {
  writeStoredReadableFont(next);
  if (next === currentReadableFont) return;
  currentReadableFont = next;
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
  const theme = useSyncExternalStore(
    subscribeAppearance,
    () => currentTheme,
    () => currentTheme,
  );
  const transparency = useSyncExternalStore(
    subscribeAppearance,
    () => currentTransparency,
    () => currentTransparency,
  );
  const readableFont = useSyncExternalStore(
    subscribeAppearance,
    () => currentReadableFont,
    () => currentReadableFont,
  );
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const prefersContrast = useMediaQuery("(prefers-contrast: more)");

  const resolvedAppearance = resolveAppearance(appearance, prefersDark);
  const contrast = resolveContrast(prefersContrast);

  useEffect(() => {
    applyThemeToDocument({
      theme,
      resolvedAppearance,
      contrast,
      transparency,
      readableFont,
    });
  }, [theme, resolvedAppearance, contrast, transparency, readableFont]);

  /** Flips between Light and Dark from whatever is showing now. */
  const toggleTheme = (): AppearanceSetting => {
    const next = resolvedAppearance === "light" ? "dark" : "light";
    setAppearance(next);
    return next;
  };

  return {
    theme,
    appearance,
    resolvedAppearance,
    contrast,
    transparency,
    readableFont,
    setAppearance,
    setTransparency,
    setReadableFont,
    toggleTheme,
  };
}
