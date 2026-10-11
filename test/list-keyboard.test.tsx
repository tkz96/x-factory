// test/list-keyboard.test.tsx — Arrow keys and Return in lists, and Mod+Enter for the primary action (#254).
// Behaviour as a user sees it: focus moves between rows, Return opens the focused row,
// Mod+Enter presses the one primary button on screen, and nothing fires while typing.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isMacPlatform } from "../src/frontend/shortcuts/registry.js";
import { useGlobalShortcuts } from "../src/frontend/shortcuts/useGlobalShortcuts.js";

afterAll(async () => {
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
});

function Harness({
  onPrimary,
  onRowOpen,
}: {
  onPrimary?: () => void;
  onRowOpen?: () => void;
}) {
  useGlobalShortcuts({
    togglePalette: () => {},
    openHelp: () => {},
    newRun: () => {},
    navigate: () => {},
  });
  return (
    <MemoryRouter>
      <div data-list id="first-list">
        <a href="#a" data-list-row id="row-a">
          A
        </a>
        <a href="#b" data-list-row id="row-b">
          B
        </a>
        <a href="#c" data-list-row id="row-c">
          C
        </a>
        <button
          type="button"
          data-list-row
          id="row-button"
          onClick={() => onRowOpen?.()}
        >
          Button row
        </button>
      </div>
      <input aria-label="Filter" id="filter" />
      <button
        type="button"
        id="approve"
        data-primary-action
        onClick={() => onPrimary?.()}
      >
        Approve
      </button>
    </MemoryRouter>
  );
}

function press(key: string, init: KeyboardEventInit = {}, target?: Element) {
  act(() => {
    (target ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const modKey = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };

describe("arrow keys move through a list (#254)", () => {
  test("ArrowDown moves focus to the next row and ArrowUp back", () => {
    render(<Harness />);
    act(() => byId("row-a").focus());
    press("ArrowDown", {}, byId("row-a"));
    expect(document.activeElement?.id).toBe("row-b");
    press("ArrowUp", {}, byId("row-b"));
    expect(document.activeElement?.id).toBe("row-a");
  });

  test("the list stops at its ends rather than wrapping", () => {
    render(<Harness />);
    act(() => byId("row-button").focus());
    press("ArrowDown", {}, byId("row-button"));
    expect(document.activeElement?.id).toBe("row-button");
  });

  test("with no row focused, ArrowDown focuses the first row", () => {
    render(<Harness />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("row-a");
  });

  test("arrow keys are ignored while typing in a text field", () => {
    render(<Harness />);
    const field = byId("filter");
    act(() => field.focus());
    press("ArrowDown", {}, field);
    expect(document.activeElement?.id).toBe("filter");
  });
});

describe("Return opens the focused row (#254)", () => {
  test("Return on a focused row activates it, once", () => {
    let opened = 0;
    render(<Harness onRowOpen={() => (opened += 1)} />);
    act(() => byId("row-button").focus());
    press("Enter", {}, byId("row-button"));
    expect(opened).toBe(1);
  });
});

describe("Mod+Enter presses the primary action (#254)", () => {
  test("Mod+Enter clicks the primary button, even from a text field", () => {
    let pressed = 0;
    render(<Harness onPrimary={() => (pressed += 1)} />);
    press("Enter", modKey, byId("filter"));
    expect(pressed).toBe(1);
  });

  test("Mod+Enter does nothing when the screen has no primary action", () => {
    let pressed = 0;
    render(
      <MemoryRouter>
        <button type="button" id="other" onClick={() => (pressed += 1)}>
          Other
        </button>
      </MemoryRouter>,
    );
    press("Enter", modKey);
    expect(pressed).toBe(0);
  });
});
