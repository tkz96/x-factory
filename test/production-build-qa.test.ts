// test/production-build-qa.test.ts — Production build artifacts verification & production server QA (XFM-65).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ServerInstance, startServer } from "../src/server.js";

describe("Production Build UI QA (XFM-65)", () => {
  const distPublicDir = path.resolve(process.cwd(), "dist", "public");
  let server: ServerInstance | null = null;
  let baseUrl: string;

  beforeAll(async () => {
    // 1. Verify that the production build output exists
    expect(existsSync(distPublicDir)).toBe(true);

    // 2. Start server pointing explicitly to dist/public in production mode
    const s = startServer(0, distPublicDir);
    server = s;
    baseUrl = `http://localhost:${s.port}`;
  });

  afterAll(() => {
    if (server) {
      server.stop(true);
    }
  });

  it("verifies production build artifact manifest, HTML shell, and asset bundles", () => {
    const indexPath = path.join(distPublicDir, "index.html");
    expect(existsSync(indexPath)).toBe(true);

    const indexHtml = readFileSync(indexPath, "utf-8");
    // Root mounting point for React 19 shell
    expect(indexHtml).toContain('id="root"');
    expect(indexHtml).toContain("<title>X-Factory</title>");

    // Hashed Vite bundle script and stylesheet
    expect(indexHtml).toMatch(/src="\/assets\/index-[a-zA-Z0-9_-]+\.js"/);
    expect(indexHtml).toContain('<link rel="stylesheet" href="/styles.css">');

    // Static assets
    expect(existsSync(path.join(distPublicDir, "styles.css"))).toBe(true);
    expect(existsSync(path.join(distPublicDir, "reference.html"))).toBe(true);
    expect(existsSync(path.join(distPublicDir, "favicon.svg"))).toBe(true);
    expect(existsSync(path.join(distPublicDir, "fonts"))).toBe(true);
  });

  it("serves bundled index.html on root GET /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toMatch(/src="\/assets\/index-[a-zA-Z0-9_-]+\.js"/);
  });

  it("serves SPA index.html fallback for client-side deep routes", async () => {
    const deepRoutes = [
      "/",
      "/queue",
      "/runs",
      "/runs/run-prod-qa-test",
      "/projects",
      "/projects/proj-prod-qa",
      "/history",
      "/settings",
      "/docs",
    ];

    for (const route of deepRoutes) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain('id="root"');
    }
  });

  it("serves favicon and API reference in production mode", async () => {
    const svgRes = await fetch(`${baseUrl}/favicon.svg`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get("Content-Type")).toContain("image/svg+xml");
    const svgText = await svgRes.text();
    expect(svgText).toContain("<svg");

    const refRes = await fetch(`${baseUrl}/reference`);
    expect(refRes.status).toBe(200);
    expect(refRes.headers.get("Content-Type")).toContain("text/html");
  });

  it("serves API endpoints cleanly alongside production static assets", async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      status: string;
      version: string;
    };
    expect(health.status).toBe("ok");
    expect(health.version).toBe("0.1.0");

    const runsRes = await fetch(`${baseUrl}/api/runs`);
    expect(runsRes.status).toBe(200);
    expect(Array.isArray(await runsRes.json())).toBe(true);
  });
});
