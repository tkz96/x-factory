// test/unused-names.test.ts — Frontend smoke: no dead copy keys, CSS classes or design tokens (spec #312).
//
// A key, class or token that nothing uses is dead weight that misleads the next
// person. These checks read src/ and index.html as text, so they run in
// milliseconds. A name the code builds at run time goes in the allowlists in
// test/helpers/unused-names.ts, with a reason for each entry.

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  copyKeys,
  definedClasses,
  definedTokens,
  readTree,
  unusedClasses,
  unusedCopyKeys,
  unusedTokens,
} from "./helpers/unused-names.js";

const ROOT = path.resolve(import.meta.dir, "..");
const code = readTree(ROOT, "src", [".ts", ".tsx"]);
const styles = readTree(ROOT, "src/frontend", [".css"]);
const html = [
  {
    file: "index.html",
    text: fs.readFileSync(path.join(ROOT, "index.html"), "utf-8"),
  },
];

describe("Frontend Smoke — dead copy, classes and tokens", () => {
  it("every key of a *_COPY map is read somewhere", () => {
    expect(unusedCopyKeys(code, code)).toEqual([]);
  });

  it("every CSS class under src/frontend is named by the code or index.html", () => {
    expect(unusedClasses(styles, [...code, ...html])).toEqual([]);
  });

  it("every token in tokens.css is read by a stylesheet, the code or index.html", () => {
    const tokens = styles.find((f) => f.file.endsWith("styles/tokens.css"));
    if (!tokens) throw new Error("tokens.css not found");
    const publicCss = readTree(ROOT, "public", [".css", ".html"]);
    expect(
      unusedTokens(tokens, [...code, ...styles, ...html, ...publicCss]),
    ).toEqual([]);
  });
});

describe("Frontend Smoke — unused-name scans catch planted names (fixture)", () => {
  const def = {
    file: "copy.ts",
    text: [
      "export const DEMO_COPY = {",
      '  used: "a",',
      '  "quoted-key": "b",',
      "  fn: (n: number) => n,",
      '  dead: "c",',
      "  nested: { inner: 1 },",
      "};",
    ].join("\n"),
  };

  it("reads the top-level keys only", () => {
    expect(copyKeys([def]).map((k) => k.key)).toEqual([
      "used",
      "quoted-key",
      "fn",
      "dead",
      "nested",
    ]);
  });

  it("fails on a planted unused key and passes once it is used", () => {
    const user = {
      file: "view.tsx",
      text: 'DEMO_COPY.used; DEMO_COPY["quoted-key"]; DEMO_COPY.fn(1); DEMO_COPY.nested;',
    };
    expect(unusedCopyKeys([def], [def, user])).toEqual([
      "copy.ts: DEMO_COPY.dead",
    ]);
    const both = { file: "view.tsx", text: `${user.text} DEMO_COPY.dead;` };
    expect(unusedCopyKeys([def], [def, both])).toEqual([]);
  });

  it("follows `import { MAP as COPY }` and a destructure", () => {
    const user = {
      file: "view.tsx",
      text: 'import { DEMO_COPY as C } from "./copy"; C.used; C.dead; C.fn; C.nested; const { x } = DEMO_COPY; DEMO_COPY["quoted-key"]',
    };
    expect(unusedCopyKeys([def], [def, user])).toEqual([]);
  });

  it("skips a map named in the allowlist", () => {
    expect(
      unusedCopyKeys([def], [def], { DEMO_COPY: "looked up by code" }),
    ).toEqual([]);
  });

  it("fails on a planted unused class and passes once the code names it", () => {
    const css = {
      file: "a.css",
      text: ".live { color: red } .dead:hover { color: blue }",
    };
    const user = { file: "a.tsx", text: '<div className="live" />' };
    expect(unusedClasses([css], [user])).toEqual(["a.css: .dead"]);
    const both = { file: "a.tsx", text: '<div className="live dead" />' };
    expect(unusedClasses([css], [both])).toEqual([]);
  });

  it("does not count a comment or a short template prefix as a use", () => {
    const css = {
      file: "a.css",
      text: ".dead-one { color: red } .tone-warn { color: red }",
    };
    const user = {
      file: "a.tsx",
      text: [
        "// dead-one is gone",
        "<b id={`dead-" + "$" + "{id}`} />",
        "<i className={`tone-" + "$" + "{t}`} />",
      ].join("\n"),
    };
    expect(unusedClasses([css], [user])).toEqual(["a.css: .dead-one"]);
  });

  it("reads class names from selectors, not from values, strings or urls", () => {
    const css =
      '.a { background: url(x.png); width: 0.5rem; content: ".b" } .c .d, .e > .f {}';
    expect([...definedClasses(css)].sort()).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("fails on a planted unused token and passes once a stylesheet reads it", () => {
    const tokens = {
      file: "tokens.css",
      text: ":root { --live: 1px; --dead: 2px; }\n.dark { --live: 3px; }",
    };
    const user = { file: "a.css", text: ".a { margin: var(--live) }" };
    expect(definedTokens(tokens.text).size).toBe(2);
    expect(unusedTokens(tokens, [tokens, user])).toEqual([
      "tokens.css: --dead",
    ]);
    const both = { file: "b.css", text: ".b { margin: var(--dead) }" };
    expect(unusedTokens(tokens, [tokens, user, both])).toEqual([]);
  });
});

describe("Frontend Smoke — the type scale exemption is exact", () => {
  const scale = {
    file: "specimen.tsx",
    text: [
      'const TYPE_SCALE = [["Body", "body"], ["Footnote", "footnote"]] as const;',
      "<p className={`text-" + "$" + "{key}`} />",
    ].join("\n"),
  };
  it("exempts only the keys in TYPE_SCALE", () => {
    const css = {
      file: "a.css",
      text: ".text-body {} .text-footnote {} .text-bogus {}",
    };
    expect(unusedClasses([css], [scale])).toEqual(["a.css: .text-bogus"]);
  });
});
