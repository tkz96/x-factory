// test/theme-saved-first-paint.test.ts — The saved Theme and Appearance reach the
// first paint of a fresh browser profile (#248, #249). The server puts the values
// from settings.json on <html> when it serves index.html; the pre-paint script in
// index.html prefers those over localStorage, which is empty in a new profile.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectSavedTheme, serveStatic } from "../src/http/static.js";

const ROOT = path.resolve(import.meta.dir, "..");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");

let base: string;
let publicDir: string;
let savedDataDir: string | undefined;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "xf-first-paint-"));
  publicDir = path.join(base, "public");
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, "index.html"), INDEX_HTML);
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  fs.rmSync(base, { recursive: true, force: true });
});

/** The <html> start tag of a served page. */
function htmlTag(body: string): string {
  return body.match(/<html\b[^>]*>/i)?.[0] ?? "";
}

describe("served index.html carries the saved Theme (#249)", () => {
  it("puts the saved Theme and Appearance on <html> for the root route", async () => {
    const res = await serveStatic("/", publicDir, {
      readSavedTheme: async () => ({ theme: "graphite", appearance: "dark" }),
    });
    const body = await res.text();

    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(htmlTag(body)).toContain('data-saved-theme="graphite"');
    expect(htmlTag(body)).toContain('data-saved-appearance="dark"');
  });

  it("injects into a client route served as the SPA fallback", async () => {
    const res = await serveStatic("/runs", publicDir, {
      readSavedTheme: async () => ({ theme: "sandstone", appearance: "light" }),
    });
    const body = await res.text();

    expect(htmlTag(body)).toContain('data-saved-theme="sandstone"');
    expect(htmlTag(body)).toContain('data-saved-appearance="light"');
  });

  it("reads settings.json through the settings module when no reader is given", async () => {
    const dataDir = fs.mkdtempSync(path.join(base, "data-"));
    fs.writeFileSync(
      path.join(dataDir, "settings.json"),
      JSON.stringify({ theme: "graphite", appearance: "dark" }),
    );
    process.env.X_FACTORY_DATA_DIR = dataDir;
    try {
      const body = await (await serveStatic("/", publicDir)).text();
      expect(htmlTag(body)).toContain('data-saved-theme="graphite"');
      expect(htmlTag(body)).toContain('data-saved-appearance="dark"');
    } finally {
      if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
      else process.env.X_FACTORY_DATA_DIR = savedDataDir;
    }
  });

  it("serves the page unchanged when the saved Theme cannot be read", async () => {
    const body = await (
      await serveStatic("/", publicDir, {
        readSavedTheme: async () => {
          throw new Error("settings unreadable");
        },
      })
    ).text();

    expect(body).toBe(INDEX_HTML);
  });

  it("sends only known Theme and Appearance values", () => {
    const tag = htmlTag(
      injectSavedTheme(INDEX_HTML, {
        theme: '"><script>',
        appearance: "neon",
      }),
    );
    expect(tag).toContain('data-saved-theme="default"');
    expect(tag).toContain('data-saved-appearance="automatic"');
    expect(tag).not.toContain("<script>");
  });
});

/** Runs the inline pre-paint script against a fake document and storage. */
function runPrePaint(
  html: string,
  stored: Record<string, string>,
  prefersDark: boolean,
) {
  const script = html.match(/<script>(\(\(\)=>[\s\S]*?\)\(\);)<\/script>/)?.[1];
  if (!script) throw new Error("pre-paint script not found");
  const tag = htmlTag(html);
  const dataset: Record<string, string> = {};
  for (const m of tag.matchAll(/data-saved-([a-z]+)="([^"]*)"/g)) {
    const key = (m[1] ?? "").replace(/-([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    dataset[`saved${key.charAt(0).toUpperCase()}${key.slice(1)}`] = m[2] ?? "";
  }
  const attrs: Record<string, string> = {};
  const documentElement = {
    dataset,
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
  };
  const fakeDocument = { documentElement };
  const fakeWindow = {
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
    }),
  };
  const fakeStorage = {
    getItem: (key: string) => stored[key] ?? null,
  };
  new Function("document", "window", "localStorage", script)(
    fakeDocument,
    fakeWindow,
    fakeStorage,
  );
  return attrs;
}

describe("the pre-paint script prefers the saved values over storage (#249)", () => {
  it("applies the saved Theme and Appearance when a fresh profile has no storage", async () => {
    const html = await (
      await serveStatic("/", publicDir, {
        readSavedTheme: async () => ({ theme: "graphite", appearance: "dark" }),
      })
    ).text();

    const attrs = runPrePaint(html, {}, false);
    expect(attrs["data-theme"]).toBe("graphite");
    expect(attrs["data-appearance"]).toBe("dark");
  });

  it("the saved values win over a stale localStorage choice", async () => {
    const html = await (
      await serveStatic("/", publicDir, {
        readSavedTheme: async () => ({ theme: "default", appearance: "light" }),
      })
    ).text();

    const attrs = runPrePaint(
      html,
      { xf_theme_choice: "sandstone", xf_appearance: "dark" },
      true,
    );
    expect(attrs["data-theme"]).toBe("default");
    expect(attrs["data-appearance"]).toBe("light");
  });

  it("falls back to localStorage when the page carries no saved values (Vite dev)", () => {
    const attrs = runPrePaint(
      INDEX_HTML,
      { xf_theme_choice: "sandstone", xf_appearance: "dark" },
      false,
    );
    expect(attrs["data-theme"]).toBe("sandstone");
    expect(attrs["data-appearance"]).toBe("dark");
  });
});
