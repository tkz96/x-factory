// test/markdown-block.test.tsx — MarkdownBlock: a Markdown preview of real elements, a Raw view of the exact
// source, a toggle only for Markdown, and no raw HTML ever made into an element.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MarkdownBlock } from "../src/frontend/components/MarkdownBlock.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

const PLAN = [
  "# Execution Plan",
  "",
  "## Context",
  "",
  "Edit `calc.ts` first.",
  "",
  "- first step",
  "- second step",
  "",
  "```ts",
  "const x = 1;",
  "```",
].join("\n");

function preview(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".md-block-preview");
  if (!el) throw new Error("the preview is missing");
  return el;
}

function toggle(container: HTMLElement, name: "Preview" | "Raw") {
  return within(
    container.querySelector<HTMLElement>(".md-block-header") ?? container,
  ).getByRole("radio", { name });
}

describe("MarkdownBlock previews Markdown as elements", () => {
  it("renders headings, lists and code as elements by default", () => {
    const { container } = render(<MarkdownBlock content={PLAN} label="Plan" />);
    const view = within(preview(container));
    expect(
      view.getByRole("heading", { level: 1, name: "Execution Plan" }),
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { level: 2, name: "Context" }),
    ).toBeTruthy();
    expect(view.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "first step",
      "second step",
    ]);
    expect(preview(container).querySelector("code")?.textContent).toBe(
      "calc.ts",
    );
    expect(
      preview(container).querySelector(".md-code-pre code")?.textContent,
    ).toBe("const x = 1;");
    expect(preview(container).textContent).not.toContain("##");
    expect(preview(container).textContent).not.toContain("`");
  });

  it("shows the label beside a Preview and Raw toggle, Preview selected by default", () => {
    const { container, getByText, getByRole } = render(
      <MarkdownBlock content={PLAN} label="Plan" />,
    );
    expect(getByText("Plan").classList.contains("md-block-label")).toBe(true);
    const group = getByRole("radiogroup", { name: "Text view" });
    expect(group).toBeTruthy();
    expect((toggle(container, "Preview") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((toggle(container, "Raw") as HTMLInputElement).checked).toBe(false);
  });

  it("shows the exact source in Raw, and returns to the preview", () => {
    const { container } = render(<MarkdownBlock content={PLAN} />);
    fireEvent.click(toggle(container, "Raw"));
    const raw = container.querySelector("pre.md-block-raw");
    expect(raw?.textContent).toBe(PLAN);
    expect(container.querySelector(".md-block-preview")).toBeNull();
    expect((toggle(container, "Raw") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle(container, "Preview"));
    expect(container.querySelector("pre.md-block-raw")).toBeNull();
    expect(
      within(preview(container)).getByRole("heading", { level: 1 }),
    ).toBeTruthy();
  });

  it("opens in Raw when the caller asks for it", () => {
    const { container } = render(
      <MarkdownBlock content={PLAN} defaultView="raw" />,
    );
    expect(container.querySelector("pre.md-block-raw")?.textContent).toBe(PLAN);
  });

  it("shows plain text with no toggle and no Markdown elements", () => {
    const { container, queryByRole, getByText } = render(
      <MarkdownBlock content={"Just one line of words."} />,
    );
    expect(queryByRole("radiogroup")).toBeNull();
    expect(getByText("Just one line of words.").className).toBe(
      "md-block-plain",
    );
    expect(container.querySelector(".md-block-preview")).toBeNull();
  });

  it("never makes an element from raw HTML in the content", () => {
    const content =
      'Look at this <img src=x onerror="window.__pwned = 1"> and **bold** text.';
    const { container } = render(<MarkdownBlock content={content} />);
    expect(preview(container).querySelector("img")).toBeNull();
    expect(preview(container).querySelector("strong")?.textContent).toBe(
      "bold",
    );
    expect(preview(container).textContent).toContain(
      '<img src=x onerror="window.__pwned = 1">',
    );
    fireEvent.click(toggle(container, "Raw"));
    expect(container.querySelector("pre.md-block-raw img")).toBeNull();
  });
});
