// test/markdown-syntax.test.ts — looksLikeMarkdown decides whether a text gets a Preview / Raw toggle.

import { describe, expect, it } from "bun:test";
import { looksLikeMarkdown } from "../src/frontend/lib/markdown-syntax.js";

describe("looksLikeMarkdown", () => {
  it("is true for each kind of Markdown syntax", () => {
    expect(looksLikeMarkdown("# Execution Plan")).toBe(true);
    expect(looksLikeMarkdown("Intro\n## Context")).toBe(true);
    expect(looksLikeMarkdown("- first step")).toBe(true);
    expect(looksLikeMarkdown("Steps:\n1. Add a toggle.")).toBe(true);
    expect(looksLikeMarkdown("> a quoted line")).toBe(true);
    expect(looksLikeMarkdown("Edit `calc.ts` first")).toBe(true);
    expect(looksLikeMarkdown("```ts\nconst x = 1;\n```")).toBe(true);
    expect(looksLikeMarkdown("**Files:** the settings page")).toBe(true);
    expect(looksLikeMarkdown("__Files__ here")).toBe(true);
    expect(looksLikeMarkdown("This is *emphasis* text")).toBe(true);
    expect(looksLikeMarkdown("This is _emphasis_ text")).toBe(true);
    expect(looksLikeMarkdown("See [the docs](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n| - | - |")).toBe(true);
  });

  it("is false for plain text, including text that only looks like symbols", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("Review the plan")).toBe(false);
    expect(looksLikeMarkdown("Hello, world.")).toBe(false);
    expect(looksLikeMarkdown("#hashtag is not a heading")).toBe(false);
    expect(looksLikeMarkdown("a * b * c")).toBe(false);
    expect(looksLikeMarkdown("snake_case_name stays plain")).toBe(false);
    expect(looksLikeMarkdown("2026-10-20 at 12:34")).toBe(false);
    expect(looksLikeMarkdown("a line\nand another line")).toBe(false);
  });

  it("treats raw HTML as plain text, since it is never rendered as HTML", () => {
    expect(looksLikeMarkdown("<img src=x onerror=alert(1)>")).toBe(false);
  });
});
