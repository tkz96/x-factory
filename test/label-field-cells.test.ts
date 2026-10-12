// test/label-field-cells.test.ts — A <label> that wraps its own field and is
// laid out as a flex or grid cell must not inherit the global form rhythm.
//
// shared/forms.css gives every label `margin-top: 1rem` and only the first
// label of a parent `margin-top: 0`. In a grid of label cells (Settings ›
// Models: the Roles row, a chosen model's details) that put the first cell
// 16px above the others. A label cell takes its spacing from its container's
// gap, so its own rule resets the margin.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const FRONTEND_DIR = path.join(import.meta.dir, "../src/frontend");

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Every class written directly on a JSX <label>. */
function labelClasses(): Set<string> {
  const classes = new Set<string>();
  for (const file of walk(FRONTEND_DIR, ".tsx")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<label\b[^>]*?className="([^"]+)"/g)) {
      for (const name of (match[1] ?? "").split(/\s+/)) classes.add(name);
    }
  }
  return classes;
}

/** The body of each top-level `.class {…}` rule, keyed by class name. */
function classRules(): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  for (const file of walk(FRONTEND_DIR, ".css")) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2] ?? "";
      for (const selector of (match[1] ?? "").split(",")) {
        const only = /^\s*\.([\w-]+)\s*$/.exec(selector);
        if (!only?.[1]) continue;
        rules.set(only[1], [...(rules.get(only[1]) ?? []), body]);
      }
    }
  }
  return rules;
}

describe("label field cells", () => {
  const labels = labelClasses();
  const rules = classRules();

  it("finds the Settings › Models field cells", () => {
    expect(labels.has("model-field")).toBe(true);
  });

  it("every label laid out as a flex or grid cell resets the global label margin", () => {
    const missing: string[] = [];
    for (const name of labels) {
      const bodies = rules.get(name) ?? [];
      const isCell = bodies.some((b) =>
        /display:\s*(flex|inline-flex|grid)\b/.test(b),
      );
      if (!isCell) continue;
      const resets = bodies.some((b) => /(^|;|\s)margin:\s*0\s*(;|$)/.test(b));
      if (!resets) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
