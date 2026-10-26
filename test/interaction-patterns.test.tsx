// test/interaction-patterns.test.tsx — The four interaction patterns of spec #292 step 5, pinned as
// tests (DESIGN.md §7, "Interaction patterns"): decision cards, confirmations, loading / empty / error,
// and status. Each pattern has one block; these tests stop a second one from growing back.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AlertDialog } from "../src/frontend/components/overlays/AlertDialog.js";
import { RunCheckpointBar } from "../src/frontend/components/runs/RunCheckpointBar.js";
import { RUN_STATUS_UI } from "../src/frontend/lib/run-status-ui.js";
import type { RunStatus } from "../src/shared/types.js";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "src", "frontend");

afterEach(cleanup);

afterAll(async () => {
  await unregisterHappyDom();
});

/** Every frontend source file (not tests), as repo-relative path and text. */
function frontendSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(tsx?|css)$/.test(entry.name) &&
        !/\.test\./.test(entry.name)
      ) {
        out.push({
          rel: path.relative(ROOT_DIR, full),
          text: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(FRONTEND_DIR);
  return out;
}

/** The 1-based line numbers where a pattern matches, for a failure that names every site. */
function sitesOf(pattern: RegExp): string[] {
  const sites: string[] = [];
  for (const { rel, text } of frontendSources()) {
    text.split("\n").forEach((line, index) => {
      // Comments describe the rule; only code can break it.
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      if (pattern.test(line)) sites.push(`${rel}:${index + 1}`);
    });
  }
  return sites;
}

describe("decision card: one primary action, secondary actions after it", () => {
  const statuses = Object.keys(RUN_STATUS_UI) as RunStatus[];
  for (const status of statuses) {
    for (const reworkReady of [false, true]) {
      it(`${status}${reworkReady ? " with rework written" : ""}: one primary, first in the card`, () => {
        const { container } = render(
          <RunCheckpointBar
            status={status}
            pending={null}
            conflict={false}
            reworkReady={reworkReady}
            onAction={() => {}}
          />,
        );
        const buttons = Array.from(container.querySelectorAll("button"));
        if (buttons.length === 0) return;
        const primaries = buttons.filter((b) =>
          b.classList.contains("ui-button--primary"),
        );
        expect(primaries.length).toBe(1);
        expect(buttons[0]).toBe(primaries[0]);
        // Mod+Enter targets the primary only when it is a real decision; a
        // promoted action on a finished run is never one key away.
        const keyed = buttons.filter((b) =>
          b.hasAttribute("data-primary-action"),
        );
        expect(keyed.length).toBeLessThanOrEqual(1);
        if (keyed.length === 1) expect(keyed[0]).toBe(primaries[0]);
      });
    }
  }
});

describe("confirmation: every confirmation is the AlertDialog block", () => {
  it("no code calls window.confirm, confirm() or alert()", () => {
    expect(sitesOf(/\b(window\.)?(confirm|alert)\s*\(/)).toEqual([]);
  });

  it('only the AlertDialog block renders role="alertdialog"', () => {
    const sites = sitesOf(/role=["']alertdialog["']/).filter(
      (site) =>
        !site.startsWith("src/frontend/components/overlays/AlertDialog.tsx:"),
    );
    expect(sites).toEqual([]);
  });

  it("no confirm button is named with a generic word (OK, Yes, Confirm)", () => {
    expect(sitesOf(/confirmText=["'{]\s*["'](OK|Yes|Confirm)["']/)).toEqual([]);
    expect(sitesOf(/>\s*(OK|Yes|Confirm)\s*</)).toEqual([]);
  });
});

describe("confirmation: the AlertDialog block names its action and waits for it", () => {
  it("the confirm button carries the action's name and runs it once, then closes", () => {
    let confirmed = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog
          id="alert-delete-run"
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Delete this run?"
          confirmText="Delete Run"
          cancelText="Keep Run"
          variant="danger"
          onConfirm={() => {
            confirmed += 1;
          }}
        />
      );
    }
    render(<Harness />);
    const dialog = document.getElementById("alert-delete-run");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === "Delete Run",
    );
    expect(confirm).toBeDefined();
    if (confirm) fireEvent.click(confirm);
    expect(confirmed).toBe(1);
  });

  it("an async confirm keeps the dialog open until the action settles", async () => {
    let finish: () => void = () => {};
    let closes = 0;
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog
          id="alert-async"
          isOpen={open}
          onClose={() => {
            closes += 1;
            setOpen(false);
          }}
          title="Enable?"
          confirmText="Enable Unsandboxed Execution"
          onConfirm={() =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
          }
        />
      );
    }
    render(<Harness />);
    const confirm = Array.from(
      document.getElementById("alert-async")?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent === "Enable Unsandboxed Execution");
    if (confirm) fireEvent.click(confirm);
    expect(closes).toBe(0);
    finish();
    await waitFor(() => {
      expect(closes).toBe(1);
    });
  });
});

describe("loading and error: AsyncRegion, Spinner or the feedback family, never hand-built markup", () => {
  it("no hand-built error line: the error-message class is gone and errors use FeedbackBanner", () => {
    expect(sitesOf(/className=["'`][^"'`]*\berror-message\b/)).toEqual([]);
  });

  it("no hand-built loading text: a wait is AsyncRegion or the Spinner block", () => {
    expect(sitesOf(/^\s*Loading [^<{}]*…\s*$/)).toEqual([]);
    expect(sitesOf(/>\s*Loading [^<{}]*…\s*</)).toEqual([]);
  });

  it("no hand-built spinner: a loader spins only in the Spinner block and the shared icon styles", () => {
    const sites = sitesOf(/animation:[^;]*spin|rotate\(360deg\)/).filter(
      (site) =>
        !site.startsWith("src/frontend/components/ui/") &&
        !site.startsWith("src/frontend/styles/"),
    );
    expect(sites).toEqual([]);
  });
});

describe("status: one status block, one wording map", () => {
  it("no hand-built pill: a status renders through the Badge block", () => {
    expect(sitesOf(/className=["'`][^"'`]*(^|\s)[\w-]*pill\b/)).toEqual([]);
  });

  it("status words are written once, in copy-map.ts or run-status-ui.ts", () => {
    const words =
      /["'>]\s*(Verified|Degraded|Verifying…|Healthy|Unavailable|Waiting for you|Merged|Closed without merging|Failed|Stopped)\s*["'<]/;
    const sites = sitesOf(words).filter(
      (site) =>
        !/(feedback\/copy-map\.ts|lib\/run-status-ui\.ts):\d+$/.test(site),
    );
    expect(sites).toEqual([]);
  });
});

describe("decision card: Mod+Enter never starts a new run", () => {
  for (const status of ["pr_created", "failed", "stopped"] as const) {
    it(`${status}: the promoted action is not the keyboard primary`, () => {
      const { container } = render(
        <RunCheckpointBar
          status={status}
          pending={null}
          conflict={false}
          reworkReady={false}
          onAction={() => {}}
        />,
      );
      expect(container.querySelector("[data-primary-action]")).toBeNull();
    });
  }
});
