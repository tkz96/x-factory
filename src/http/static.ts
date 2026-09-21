// src/http/static.ts — Static asset file serving with path traversal protection, MIME resolution, and SPA fallback.

import path from "node:path";

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

/**
 * Serves the SPA index.html fallback for client-side deep routes or root index.
 */
async function tryServeSpaFallback(
  publicDir: string,
  pathname: string,
  ext: string,
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
      return new Response(file, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
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
): Promise<Response> {
  const relPath = resolveCanonicalPath(pathname);
  const filePath = path.normalize(path.join(publicDir, relPath));

  // Prevent directory traversal attacks
  if (!filePath.startsWith(publicDir)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        "Content-Type": getMimeType(filePath),
      },
    });
  }

  // SPA routing fallback: serve index.html for client routes or root
  const ext = path.extname(filePath);
  const spaResponse = await tryServeSpaFallback(publicDir, pathname, ext);
  if (spaResponse) {
    return spaResponse;
  }

  return new Response("Not Found", { status: 404 });
}
