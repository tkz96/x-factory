// test/ui-loading-states.test.tsx — The loading half of the control vocabulary
// (#251, spec #241): static placeholder rows in lists (never an animated
// shimmer), one standard spinner for small inline waits, 44pt touch targets and
// the focus ring's 3:1 pair. The rules are measured from the stylesheets the
// browser loads, and the list behaviour is measured from a real read region.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { AsyncRegion } from "../src/frontend/components/feedback/AsyncRegion.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunsView } from "../src/frontend/views/RunsView.js";
import { composite, contrastRatio, parseColor } from "./helpers/contrast.js";

const ROOT = `${import.meta.dir}/..`;
const TOKENS = await Bun.file(`${ROOT}/src/frontend/styles/tokens.css`).text();
const CONTROLS = await Bun.file(
  `${ROOT}/src/frontend/styles/shared/controls.css`,
).text();
const FORMS = await Bun.file(
  `${ROOT}/src/frontend/styles/shared/forms.css`,
).text();
const RUNS_VIEW = await Bun.file(
  `${ROOT}/src/frontend/views/RunsView.css`,
).text();

/** The declarations of one rule, by its exact selector text. */
function declarationsFor(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = rule[1] ?? "";
    // A selector nested in :is(...) (the block focus ring) is not a rule of its
    // own: skip it so each block is read from its own declaration block.
    if (selectorText.includes(":is(")) continue;
    const selectors = selectorText.split(",").map((part) => part.trim());
    if (selectors.includes(selector)) return rule[2] ?? "";
  }
  throw new Error(`No rule found for ${selector}`);
}

/** Every rule that names the selector, not just the first: a touch override sits in a later @media block. */
function allDeclarationsFor(css: string, selector: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? "").split(",").map((part) => part.trim());
    if (selectors.includes(selector)) out.push(rule[2] ?? "");
  }
  return out;
}

/** A custom property's first value in tokens.css — the light default set. */
function rootToken(name: string): string {
  const stripped = TOKENS.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = stripped.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (match === null) throw new Error(`${name} is not defined`);
  return (match[1] ?? "").trim();
}

describe("touch targets and the row height come from tokens", () => {
  it("a finger-sized control is at least 44 points tall", () => {
    expect(rootToken("--tap-min")).toBe("44px");

    // Regular controls take their height from the metric token (28px on macOS,
    // 44px on iOS). A touch input or a narrow viewport raises every one of them
    // to --tap-min in the coarse-pointer block (spec #292, Type scale and density).
    for (const selector of [
      ".ui-button",
      ".ui-icon-button",
      ".ui-select-trigger",
      ".ui-segment",
    ]) {
      expect(allDeclarationsFor(CONTROLS, selector).join("\n")).toContain(
        "var(--control-height)",
      );
      expect(
        allDeclarationsFor(CONTROLS, selector).some(
          (body) =>
            body.includes("min-height: var(--tap-min)") ||
            body.includes("height: var(--tap-min)"),
        ),
      ).toBe(true);
    }
    for (const selector of [
      ".ui-field-input",
      ".ui-textarea",
      ".ui-select-item",
      ".ui-switch",
    ]) {
      expect(declarationsFor(CONTROLS, selector)).toContain(
        "min-height: var(--tap-min)",
      );
    }

    // A list row is taller than the minimum — and still clears it.
    expect(declarationsFor(CONTROLS, ".ui-list-row")).toContain(
      "min-height: var(--list-row-height)",
    );
    // The legacy field classes are still regular controls: a text input on a
    // project-detail or a model connection clears the minimum too.
    for (const selector of [".form-input", ".form-select"]) {
      expect(declarationsFor(FORMS, selector)).toContain(
        "min-height: var(--control-height)",
      );
      expect(
        allDeclarationsFor(FORMS, selector).some((body) =>
          body.includes("min-height: var(--tap-min)"),
        ),
      ).toBe(true);
    }
    // A grouped row is a finger's target too: the compact row inside a
    // ListGroup is at least --tap-min tall.
    expect(declarationsFor(CONTROLS, ".ui-list-row--compact")).toContain(
      "min-height: var(--tap-min)",
    );
    expect(
      Number.parseFloat(rootToken("--list-row-height")),
    ).toBeGreaterThanOrEqual(Number.parseFloat(rootToken("--tap-min")));
  });

  it("the real list row and its placeholder reserve one row height", () => {
    expect(rootToken("--list-row-height")).toBe("72px");
    expect(declarationsFor(CONTROLS, ".ui-list-row")).toContain(
      "min-height: var(--list-row-height)",
    );
    // The Runs list's own row is the shared row, so the placeholder rows a
    // loading Runs list shows have the height the loaded rows will have.
    expect(declarationsFor(RUNS_VIEW, ".run-row-link")).toContain(
      "min-height: var(--list-row-height)",
    );
  });
});

describe("placeholder rows are static, and the wait is one spinner", () => {
  it("a placeholder row never animates", () => {
    const placeholder = declarationsFor(CONTROLS, ".ui-list-row--placeholder");
    expect(placeholder).not.toContain("animation");
    expect(placeholder).toContain("pointer-events: none");
    // No keyframes, and no shimmer by any name, anywhere in the block layer.
    expect(CONTROLS).not.toContain("@keyframes");
    expect(CONTROLS.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/shimmer/i);
  });

  it("lists reserve placeholder rows while loading, not a spinner", () => {
    const { container, getByRole } = render(
      createElement(AsyncRegion, {
        derived: { state: "loading", suppressed: [], error: undefined },
        placeholderRows: 3,
      }),
    );

    expect(
      container.querySelectorAll(".ui-list-row--placeholder"),
    ).toHaveLength(3);
    expect(container.querySelector(".icon-spin")).toBeNull();
    // The wait is still announced, once.
    expect(getByRole("status").textContent).toBe("Loading…");
  });

  it("a small inline wait uses the one standard spinner", () => {
    const { container, getByRole } = render(
      createElement(AsyncRegion, {
        derived: { state: "loading", suppressed: [], error: undefined },
      }),
    );

    expect(
      container.querySelectorAll(".ui-list-row--placeholder"),
    ).toHaveLength(0);
    expect(container.querySelector(".ui-wait")).not.toBeNull();
    expect(container.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-loader-2",
    );
    expect(getByRole("status").textContent).toBe("Loading…");
  });

  it("the Runs list loads as placeholder rows", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryDefaults(queryKeys.runs(), {
      queryFn: () => new Promise(() => {}),
    });
    client.setQueryData(queryKeys.projects(), []);
    const { container, findByRole } = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          ModalProvider,
          null,
          createElement(
            MemoryRouter,
            { initialEntries: ["/runs?filter=done"] },
            createElement(ProjectProvider, null, createElement(RunsView)),
          ),
        ),
      ),
    );

    expect(
      container.querySelectorAll(".ui-list-row--placeholder"),
    ).toHaveLength(5);
    expect(container.querySelector(".icon-spin")).toBeNull();
    expect((await findByRole("status")).textContent).toBe("Loading…");
  });
});

describe("the focus ring is one token pair, at 3:1 or better", () => {
  it("every interactive block shows the ring for keyboard focus", () => {
    const ring = CONTROLS.replace(/\/\*[\s\S]*?\*\//g, "").match(
      /:is\([\s\S]*?data-focus-visible\]\s*\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring?.[1]).toContain(
      "outline: var(--border-width-indicator) solid var(--border-focus)",
    );
  });

  it("the ring's pair meets 3:1 against the canvas and the card", () => {
    // The twelve-set theme × appearance × contrast gate proves this for every
    // theme (test/theme-contrast.test.ts). This asserts the default set the
    // blocks are styled against ships the same guarantee.
    const ring = parseColor(rootToken("--border-focus"));
    for (const surface of ["--bg", "--bg-card"]) {
      const background = parseColor(rootToken(surface));
      expect(
        contrastRatio(composite(ring, background), background),
      ).toBeGreaterThanOrEqual(3.0);
    }
  });
});

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
});
