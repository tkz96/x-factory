// src/http/static.ts — Static asset file serving with path traversal protection and MIME resolution.

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

export async function serveStatic(pathname: string, publicDir: string): Promise<Response> {
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
