// test/helpers/off-origin-scan.ts — Finds references that would make a browser
// ask a host other than X-Factory's own origin (spec #241, ticket #247).
//
// The scan reads what a browser is served: HTML pages, CSS, and the TSX and TS
// the frontend is built from. It reports `src`, `srcset`, `poster`, `@import`
// and `url()`, and `href` on anything that is not a plain navigation link
// (`<a>`, `<area>`). Minified JavaScript bundles are out of scope: every bundle
// carries URL string literals that are never fetched. What a running page
// actually requests, JavaScript included, is covered by the Playwright network
// test in test/no-third-party-requests.test.ts. See docs/agents/ci-checks.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type SourceKind = "html" | "css" | "script";

export interface ScannedSource {
  /** Repository-relative path, for the finding. */
  readonly file: string;
  readonly kind: SourceKind;
  readonly text: string;
}

export interface OffOriginReference {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly url: string;
}

/** Schemes that name no host: inline data, and blobs the page itself made. */
const HOST_FREE_SCHEME = /^(?:data|blob):/i;
/** A URL token with an authority: `https://…` or `//cdn.example.com/…`. */
const URL_TOKEN = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'`<>()\\]+/gi;
/** Attributes whose value the browser loads from that URL. */
const LOADED_ATTRIBUTES = new Set(["src", "srcset", "poster"]);
/** Elements whose `href` is a link a person follows, not a resource we load. */
const NAVIGATION_TAGS = new Set(["a", "area"]);
const TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE =
  /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s>]+))/g;
const IMPORT_RULE = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /(?<![\w-])url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/g;
/** A call that would reach the network from JavaScript. */
const REQUEST_CALL =
  /\b(?:fetch|EventSource|WebSocket|Worker|SharedWorker|importScripts|sendBeacon)\s*\(\s*["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi;

/** True when a URL names a host, so the browser would leave this origin. */
export function hasHost(url: string): boolean {
  const value = url.trim();
  if (!value || value.startsWith("#")) {
    return false;
  }
  if (value.startsWith("//")) {
    return true;
  }
  if (HOST_FREE_SCHEME.test(value)) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function attributePairs(markup: string): { name: string; value: string }[] {
  const pairs: { name: string; value: string }[] = [];
  for (const match of markup.matchAll(ATTRIBUTE)) {
    pairs.push({
      name: (match[1] ?? "").toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? match[5] ?? "",
    });
  }
  return pairs;
}

function scanAttributes(
  source: ScannedSource,
  findings: OffOriginReference[],
): void {
  for (const tag of source.text.matchAll(TAG)) {
    const element = (tag[1] ?? "").toLowerCase();
    const markup = tag[2] ?? "";
    for (const attribute of attributePairs(markup)) {
      const { name } = attribute;
      if (name === "href" && NAVIGATION_TAGS.has(element)) {
        continue;
      }
      if (name !== "href" && !LOADED_ATTRIBUTES.has(name)) {
        continue;
      }
      const value = attribute.value.trim();
      // `data:` and `blob:` name no host, whatever they embed: a data URI is
      // opaque, so nothing inside it is fetched.
      if (HOST_FREE_SCHEME.test(value)) {
        continue;
      }
      for (const token of value.matchAll(URL_TOKEN)) {
        const url = token[0];
        if (!hasHost(url)) {
          continue;
        }
        findings.push({
          file: source.file,
          line: lineAt(source.text, (tag.index ?? 0) + tag[0].indexOf(url)),
          reason: `<${element} ${name}>`,
          url,
        });
      }
    }
  }
}

function scanCss(source: ScannedSource, findings: OffOriginReference[]): void {
  for (const match of source.text.matchAll(IMPORT_RULE)) {
    const url = match[1] ?? match[2] ?? "";
    if (hasHost(url)) {
      findings.push({
        file: source.file,
        line: lineAt(source.text, match.index ?? 0),
        reason: "@import",
        url,
      });
    }
  }
  for (const match of source.text.matchAll(CSS_URL)) {
    const url = match[1] ?? match[2] ?? match[3] ?? "";
    if (hasHost(url)) {
      findings.push({
        file: source.file,
        line: lineAt(source.text, match.index ?? 0),
        reason: "url()",
        url,
      });
    }
  }
}

function scanRequests(
  source: ScannedSource,
  findings: OffOriginReference[],
): void {
  for (const match of source.text.matchAll(REQUEST_CALL)) {
    findings.push({
      file: source.file,
      line: lineAt(source.text, match.index ?? 0),
      reason: `${match[0].slice(0, match[0].indexOf("(")).trim()}()`,
      url: match[1] ?? "",
    });
  }
}

/** Reports every reference in one file that would leave this origin. */
export function scanSource(source: ScannedSource): OffOriginReference[] {
  const findings: OffOriginReference[] = [];
  if (source.kind !== "css") {
    scanAttributes(source, findings);
    scanRequests(source, findings);
  }
  scanCss(source, findings);
  return findings;
}

export function scanSources(
  sources: readonly ScannedSource[],
): OffOriginReference[] {
  return sources.flatMap(scanSource);
}

function collect(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collect(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

function kindOf(file: string): SourceKind {
  if (file.endsWith(".css")) {
    return "css";
  }
  return file.endsWith(".html") ? "html" : "script";
}

/**
 * Every file the browser is served from this repository: the page shells, the
 * stylesheets and the frontend sources, plus `dist/public` when it is built.
 */
export function defaultSources(root: string): ScannedSource[] {
  const files = [
    path.join(root, "index.html"),
    ...collect(path.join(root, "public"), [".html", ".css"]),
    ...collect(path.join(root, "src", "frontend"), [".tsx", ".ts", ".css"]),
    ...collect(path.join(root, "dist", "public"), [".html", ".css"]),
  ];
  return files
    .filter((file) => existsSync(file))
    .map((file) => ({
      file: path.relative(root, file),
      kind: kindOf(file),
      text: readFileSync(file, "utf8"),
    }));
}
