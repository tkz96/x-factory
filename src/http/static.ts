// src/http/static.ts — Static asset file serving with path traversal protection, MIME resolution, and SPA fallback.

import path from "node:path";
import { loadSettings } from "../settings.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/**
 * Resolves virtual routes (root, API reference) to canonical static file basenames.
 */
function resolveCanonicalPath(pathname: string): string {
  if (pathname === "/") {
    return "index.html";
  }
  if (
    pathname === "/reference" ||
    pathname === "/reference/" ||
    pathname === "/scalar" ||
    pathname === "/scalar/" ||
    pathname === "/api-docs" ||
    pathname === "/api-docs/"
  ) {
    return "reference.html";
  }
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

/**
 * Returns the MIME content type for a given file path based on its extension.
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath);
  return MIME_TYPES[ext] || "application/octet-stream";
}

const SAVED_THEMES = ["default", "graphite", "sandstone"];
const SAVED_APPEARANCES = ["automatic", "light", "dark"];

/** The Theme and Appearance saved in settings.json, read before first paint (#249). */
export interface SavedTheme {
  theme: string;
  appearance: string;
}

export interface StaticOptions {
  /** Reads the saved Theme; the default reads settings.json. */
  readSavedTheme?: () => Promise<SavedTheme>;
}

/**
 * Puts the saved Theme and Appearance on the <html> element, so the pre-paint
 * script in index.html applies them before React loads, even in a browser
 * profile whose localStorage is empty. Values outside the known set fall back
 * to the defaults; a document with no <html> tag is returned unchanged.
 */
export function injectSavedTheme(html: string, saved: SavedTheme): string {
  const theme = SAVED_THEMES.includes(saved.theme) ? saved.theme : "default";
  const appearance = SAVED_APPEARANCES.includes(saved.appearance)
    ? saved.appearance
    : "automatic";
  return html.replace(
    /<html\b([^>]*)>/i,
    (_tag, attrs: string) =>
      `<html${attrs} data-saved-theme="${theme}" data-saved-appearance="${appearance}">`,
  );
}

async function readSettingsTheme(): Promise<SavedTheme> {
  const settings = await loadSettings(false);
  return { theme: settings.theme, appearance: settings.appearance };
}

/**
 * Serves index.html with the saved Theme injected. If the settings cannot be
 * read the page is served as it is, and the pre-paint script falls back to
 * localStorage.
 */
async function serveIndex(
  file: ReturnType<typeof Bun.file>,
  options: StaticOptions,
): Promise<Response> {
  const html = await file.text();
  let body = html;
  try {
    const saved = await (options.readSavedTheme ?? readSettingsTheme)();
    body = injectSavedTheme(html, saved);
  } catch {
    body = html;
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Serves the SPA index.html fallback for client-side deep routes or root index.
 */
async function tryServeSpaFallback(
  publicDir: string,
  pathname: string,
  ext: string,
  options: StaticOptions,
): Promise<Response | null> {
  if (ext && ext !== ".html") {
    return null;
  }
  if (ext === ".html" && pathname !== "/" && pathname !== "index.html") {
    return null;
  }

  const candidates = [
    path.join(publicDir, "index.html"),
    path.resolve(publicDir, "..", "index.html"),
    path.resolve(publicDir, "..", "dist", "public", "index.html"),
  ];

  for (const candidate of candidates) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return serveIndex(file, options);
    }
  }

  return null;
}

/**
 * Serves static files with directory traversal guards and SPA fallback.
 */
export async function serveStatic(
  pathname: string,
  publicDir: string,
  options: StaticOptions = {},
): Promise<Response> {
  const relPath = resolveCanonicalPath(pathname);
  const filePath = path.normalize(path.join(publicDir, relPath));

  // Prevent directory traversal attacks
  const canonicalPublicDir = publicDir.endsWith(path.sep)
    ? publicDir
    : publicDir + path.sep;
  if (!filePath.startsWith(canonicalPublicDir) && filePath !== publicDir) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (relPath === "index.html" && (await file.exists())) {
    return serveIndex(file, options);
  }
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        "Content-Type": getMimeType(filePath),
      },
    });
  }

  // SPA routing fallback: serve index.html for client routes or root
  const ext = path.extname(filePath);
  const spaResponse = await tryServeSpaFallback(
    publicDir,
    pathname,
    ext,
    options,
  );
  if (spaResponse) {
    return spaResponse;
  }

  return new Response("Not Found", { status: 404 });
}
