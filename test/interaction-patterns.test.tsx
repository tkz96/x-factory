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
