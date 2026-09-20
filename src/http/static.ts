// src/http/static.ts — Static asset file serving with path traversal protection, MIME resolution, and native Bun TypeScript bundling.

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

let appBundleCache: { content: string; mtime: number } | null = null;

async function bundleFrontend(entryPath: string): Promise<string> {
  const tsFile = Bun.file(entryPath);
  const stat = await tsFile.stat();
  const mtime = stat.mtimeMs;

  if (appBundleCache && appBundleCache.mtime === mtime) {
    return appBundleCache.content;
  }

  const buildResult = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    format: "esm",
  });

  if (!buildResult.success || !buildResult.outputs[0]) {
    const logs = buildResult.logs.map((l) => l.message).join("\n");
    throw new Error(`Frontend bundling failed: ${logs}`);
  }

  const content = await buildResult.outputs[0].text();
  appBundleCache = { content, mtime };
  return content;
}

/**
 * Resolves virtual routes (root, docs, API reference) to canonical static file basenames.
 */
function resolveCanonicalPath(pathname: string): string {
  if (pathname === "/") {
    return "index.html";
  }
  if (pathname === "/docs" || pathname === "/docs/") {
    return "docs.html";
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
 * Attempts on-the-fly development bundling or transpilation if a .ts source file exists for a requested .js path.
 */
async function tryServeDevTranspilation(
  filePath: string,
  relPath: string,
): Promise<Response | null> {
  if (process.env.NODE_ENV === "production" || !filePath.endsWith(".js")) {
    return null;
  }

  const tsPath = `${filePath.slice(0, -3)}.ts`;
  const tsFile = Bun.file(tsPath);
  if (!(await tsFile.exists())) {
    return null;
  }

  try {
    const content =
      relPath === "app.js"
        ? await bundleFrontend(tsPath)
        : await new Bun.Transpiler({ loader: "ts" }).transform(
            await tsFile.text(),
          );
    return new Response(content, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
      },
    });
  } catch (err) {
    return new Response(
      `Build Error: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500, headers: { "Content-Type": "text/plain" } },
    );
  }
}

/**
 * Serves the SPA index.html fallback for client-side deep routes without file extensions.
 */
async function tryServeSpaFallback(
  publicDir: string,
  ext: string,
): Promise<Response | null> {
  if (ext) {
    return null;
  }

  const indexPath = path.join(publicDir, "index.html");
  const indexFile = Bun.file(indexPath);
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return null;
}

/**
 * Serves static files with directory traversal guards, development bundling, and SPA fallback.
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

  // Development transpilation fallback
  const devResponse = await tryServeDevTranspilation(filePath, relPath);
  if (devResponse) {
    return devResponse;
  }

  // SPA routing fallback: serve index.html for client routes without extension
  const ext = path.extname(filePath);
  const spaResponse = await tryServeSpaFallback(publicDir, ext);
  if (spaResponse) {
    return spaResponse;
  }

  return new Response("Not Found", { status: 404 });
}
