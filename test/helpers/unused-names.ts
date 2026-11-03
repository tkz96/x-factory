// test/helpers/unused-names.ts — finds copy-map keys and CSS classes that no code uses (spec #312).
//
// A key in a *_COPY object or a class in a stylesheet that nothing reads is dead
// text or dead style. It misleads the next person and can drift from the product.
// The scans are static and fast: one pass over src/ and index.html, no build.

import fs from "node:fs";
import path from "node:path";

export interface SourceFile {
  file: string;
  text: string;
}

export function readTree(
  root: string,
  dir: string,
  exts: string[],
): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push({
          file: path.relative(root, full),
          text: fs.readFileSync(full, "utf-8"),
        });
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}

// ---------------------------------------------------------------------------
// Copy-map keys
// ---------------------------------------------------------------------------

export interface CopyKey {
  map: string;
  key: string;
  file: string;
}

/** Index just past the string, template or comment that starts at `i`; `i` when none starts there. */
function skipLiteral(text: string, i: number): number {
  const ch = text[i];
  if (ch === "/" && text[i + 1] === "/") {
    const end = text.indexOf("\n", i);
    return end === -1 ? text.length : end;
  }
  if (ch === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (ch === "`") {
    let j = i + 1;
    while (j < text.length && text[j] !== "`") {
      if (text[j] === "\\") j += 2;
      else if (text[j] === "$" && text[j + 1] === "{") {
        j = skipBalanced(text, j + 1);
      } else j += 1;
    }
    return j + 1;
  }
  return i;
}

/** Index just past the `{...}` group that opens at `open`. */
function skipBalanced(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const next = skipLiteral(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const ch = text[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** The keys written directly inside the object literal that opens at `open`. */
function topLevelKeys(text: string, open: number): string[] {
  const keys: string[] = [];
  const end = skipBalanced(text, open) - 1;
  let i = open + 1;
  let depth = 0;
  let expectKey = true;
  while (i < end) {
    const next = skipLiteral(text, i);
    const ch = text[i] as string;
    if (depth === 0 && expectKey) {
      const quoted = /^(["'])([^"'\n]+)\1\s*[:(]/.exec(text.slice(i, i + 200));
      const ident = /^([A-Za-z_$][\w$]*)\s*[:(,}]/.exec(text.slice(i, i + 200));
      if (quoted?.[2] !== undefined) {
        keys.push(quoted[2]);
        expectKey = false;
      } else if (ident?.[1] !== undefined) {
        keys.push(ident[1]);
        expectKey = false;
      } else if (!/\s/.test(ch) && next === i) {
        expectKey = false;
      }
    }
    if (next !== i) {
      i = next;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) expectKey = true;
    i += 1;
  }
  return keys;
}

/** Top-level keys of every exported `*_COPY` object literal. */
export function copyKeys(files: SourceFile[]): CopyKey[] {
  const out: CopyKey[] = [];
  for (const { file, text } of files) {
    for (const decl of text.matchAll(
      /export const ([A-Z][A-Z0-9_]*_COPY)\b[^=;]*?=\s*(?:\(\s*)?\{/g,
    )) {
      const open = decl.index + decl[0].length - 1;
      const map = decl[1] as string;
      for (const key of topLevelKeys(text, open)) out.push({ map, key, file });
    }
  }
  return out;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `MAP.key`, `MAP["key"]` or `const { key } = MAP` appears in the code. */
export function copyKeyIsUsed(
  { map, key }: CopyKey,
  code: SourceFile[],
): boolean {
  const k = escapeRe(key);
  return code.some(({ text }) => {
    if (!text.includes(map)) return false;
    // `import { MAP as COPY }` renames the map inside one file.
    const names = [map];
    for (const alias of text.matchAll(
      new RegExp(`\\b${escapeRe(map)}\\s+as\\s+([A-Za-z_$][\\w$]*)`, "g"),
    )) {
      names.push(alias[1] as string);
    }
    return names.some((name) => {
      const n = escapeRe(name);
      return [
        new RegExp(`\\b${n}\\s*\\??\\.\\s*${k}\\b`),
        new RegExp(`\\b${n}\\s*\\??\\.?\\[\\s*["'\`]${k}["'\`]\\s*\\]`),
        new RegExp(`\\{[^{}=]*\\b${k}\\b[^{}=]*\\}\\s*=\\s*${n}\\b`),
      ].some((pattern) => pattern.test(text));
    });
  });
}

/**
 * Maps that code reads with a variable key (`MAP[code]`), so a key's use cannot
 * be seen statically. Each entry names why. Keep this list short.
 */
export const DYNAMIC_COPY_MAPS: Record<string, string> = {
  ERROR_COPY: "looked up by error code",
  DEGRADED_CAPABILITY_COPY: "looked up by capability name",
  VALIDATION_FIELD_ERROR_COPY: "looked up by validation code",
  VALIDATION_FORM_ERROR_COPY: "looked up by validation code",
  PROVIDER_ERROR_COPY: "looked up by provider error code",
  REPOSITORY_SETTINGS_COPY:
    "indexed by the check field name (test, typecheck, lint)",
};

/**
 * Single keys that code reads through a variable, as `COPY[field]`. Each entry
 * is `MAP.key` and names why.
 */
export const DYNAMIC_COPY_KEYS: Record<string, string> = {
  ...Object.fromEntries(
    [
      "contextWindow",
      "maxOutputTokens",
      "inputPricePerMTok",
      "outputPricePerMTok",
      "rpm",
      "tpm",
      "rpd",
      "tpd",
      "budgetUsd",
      "budgetRequests",
    ].map((key) => [
      `MODEL_CONNECTIONS_COPY.${key}`,
      "field label, read as COPY[key] in ModelConnectionsPanel",
    ]),
  ),
  "MODEL_ROLES_COPY.builder": "role label, read as COPY[role] in RolesPanel",
  "MODEL_ROLES_COPY.reviewer": "role label, read as COPY[role] in RolesPanel",
};

export function unusedCopyKeys(
  defs: SourceFile[],
  code: SourceFile[],
  dynamicMaps: Record<string, string> = DYNAMIC_COPY_MAPS,
  dynamicKeys: Record<string, string> = DYNAMIC_COPY_KEYS,
): string[] {
  return copyKeys(defs)
    .filter((entry) => !(entry.map in dynamicMaps))
    .filter((entry) => !(`${entry.map}.${entry.key}` in dynamicKeys))
    .filter((entry) => !copyKeyIsUsed(entry, code))
    .map((entry) => `${entry.file}: ${entry.map}.${entry.key}`);
}

// ---------------------------------------------------------------------------
// CSS classes
// ---------------------------------------------------------------------------

function stripCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, "");
}

/** Drops `/* */ ` blocks and whole-line or trailing `; //` comments, so prose cannot count as a use. */
function stripCodeComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}),])\/\/.*$/gm, "$1")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/** Class names a stylesheet defines in selectors (not in declaration bodies). */
export function definedClasses(css: string): Set<string> {
  const out = new Set<string>();
  const stripped = stripCss(css);
  // Selector text is whatever sits before a `{`. Declaration values never hold `.name` before `{`.
  for (const match of stripped.matchAll(/([^{};]+)\{/g)) {
    const prelude = match[1] ?? "";
    if (/^\s*@(keyframes|font-face|property|layer)/.test(prelude)) continue;
    for (const cls of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (cls[1]) out.add(cls[1]);
    }
  }
  return out;
}

/**
 * Classes that code never names, or builds from a prefix it does name.
 * `code` holds every file a class may be written in (TSX, TS, index.html).
 */
export function unusedClasses(
  styles: SourceFile[],
  code: SourceFile[],
  allow: Record<string, string> = ALLOWED_CLASS_PREFIXES,
): string[] {
  const text = code.map((c) => stripCodeComments(c.text)).join("\n");
  const words = new Set(text.match(/[A-Za-z_][\w-]*/g) ?? []);
  // `icon-${size}` names a family of one-word variants (`icon-sm`); a longer tail such as `icon-status-passed` is not covered. Only a template that sits inside a
  // class expression counts, so an id such as `run-${id}` hides nothing.
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  for (const m of text.matchAll(/([A-Za-z_][\w-]*-)\$\{/g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
    if (/class/i.test(before)) prefixes.push(m[1] as string);
  }
  for (const m of text.matchAll(/\}([\w]*-[\w-]+)/g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
    if (/class/i.test(before)) suffixes.push(m[1] as string);
  }
  const out: string[] = [];
  for (const { file, text: css } of styles) {
    for (const cls of definedClasses(css)) {
      if (words.has(cls)) continue;
      if (
        prefixes.some(
          (p) => cls.startsWith(p) && !cls.slice(p.length).includes("-"),
        )
      )
        continue;
      if (
        suffixes.some(
          (s) => cls.endsWith(s) && !cls.slice(0, -s.length).includes("-"),
        )
      )
        continue;
      if (Object.keys(allow).some((p) => cls.startsWith(p))) continue;
      out.push(`${file}: .${cls}`);
    }
  }
  return out.sort();
}

/**
 * Class prefixes that a library or the browser puts on the page, not our JSX.
 * Each entry names why.
 */
export const ALLOWED_CLASS_PREFIXES: Record<string, string> = {
  "react-flow": "React Flow adds these class names itself",
  "react-aria-": "React Aria Components adds these default class names",
  "text-": "the type scale is built as text-<key> in the specimen page",
};

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

/** Custom properties the token file defines. */
export function definedTokens(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripCss(css).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
    out.add(m[1] as string);
  }
  return out;
}

/**
 * Tokens that code reads through a name it builds, such as `--text-${key}`.
 * Each entry is a prefix and names why.
 */
export const DYNAMIC_TOKEN_PREFIXES: Record<string, string> = {
  "--text-": "the specimen tuner builds --text-<key> and --text-<key>-weight",
};

/** Tokens defined in `tokensFile` that nothing reads. A read is `var(--x)` or the bare name in code. */
export function unusedTokens(
  tokensFile: SourceFile,
  everything: SourceFile[],
  dynamic: Record<string, string> = DYNAMIC_TOKEN_PREFIXES,
): string[] {
  const text = everything
    .map((f) => (f.file.endsWith(".css") ? stripCss(f.text) : f.text))
    .join("\n");
  const out: string[] = [];
  for (const token of definedTokens(tokensFile.text)) {
    if (Object.keys(dynamic).some((p) => token.startsWith(p))) continue;
    const name = escapeRe(token);
    // A use is the name not followed by `:` (that is a definition) or more name characters.
    const use = new RegExp(`${name}(?![\\w-])(?!\\s*:)`);
    if (!use.test(text)) out.push(`${tokensFile.file}: ${token}`);
  }
  return out.sort();
}
