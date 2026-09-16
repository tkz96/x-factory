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

  if (
    process.env.NODE_ENV === "production" &&
    appBundleCache &&
    appBundleCache.mtime === mtime
  ) {
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

export async function serveStatic(
  pathname: string,
  publicDir: string,
): Promise<Response> {
  let relPath = pathname === "/" ? "index.html" : pathname;
  if (relPath.startsWith("/")) relPath = relPath.slice(1);

  const filePath = path.normalize(path.join(publicDir, relPath));

  // Prevent directory traversal attacks
  if (!filePath.startsWith(publicDir)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    // If a .js file is requested but a .ts file exists, transpile or bundle on the fly
    if (filePath.endsWith(".js")) {
      const tsPath = `${filePath.slice(0, -3)}.ts`;
      const tsFile = Bun.file(tsPath);
      if (await tsFile.exists()) {
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
    }

    return new Response("Not Found", { status: 404 });
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
    },
  });
}
