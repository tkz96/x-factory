// test/command-palette.test.tsx — Command palette, ? sheet and the global shortcut handler (#254).
// Behaviour as a user sees it: what opens, what navigates, what is ignored while typing.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { useState } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { CommandPalette } from "../src/frontend/components/palette/CommandPalette.js";
import { ShortcutSheet } from "../src/frontend/components/palette/ShortcutSheet.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  isMacPlatform,
  shortcutLabel,
} from "../src/frontend/shortcuts/registry.js";
import { useGlobalShortcuts } from "../src/frontend/shortcuts/useGlobalShortcuts.js";
import type { Project, Run } from "../src/shared/types.js";

afterAll(async () => {
  await unregisterHappyDom();
});

afterEach(() => {
  cleanup();
});

const PROJECT: Pick<Project, "id" | "name"> = {
  id: "demo-app",
  name: "Demo App",
};

function makeRun(id: string, ticketId: string, title: string): Run {
  return {
    id,
    project: PROJECT,
    ticket: { id: ticketId, title, acceptanceCriteria: [] },
    plan: "",
    branch: `feat/${ticketId.toLowerCase()}`,
    status: "awaiting_plan_approval",
    startedAt: "2026-10-01T00:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
  } as unknown as Run;
}

const RUNS = [
  makeRun("run-1", "ENG-7", "Add retry to the webhook sender"),
  makeRun("run-2", "ENG-12", "Document the approval flow"),
];

/** Mirrors the wiring in AppShell: one global handler, palette and ? sheet. */
function Shell({
  stopRunAvailable = false,
  onStopRun = () => {},
  onToggleAppearance = () => {},
}: {
  stopRunAvailable?: boolean;
  onStopRun?: () => void;
  onToggleAppearance?: () => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useGlobalShortcuts({
    togglePalette: () => setPaletteOpen((open) => !open),
    openHelp: () => setSheetOpen(true),
    newRun: () => {},
    navigate: (path) => navigate(path),
  });
  return (
    <>
      <main>
        <input aria-label="Ticket filter" data-search-input />
        <input aria-label="Note field" />
        <span data-testid="location">{location.pathname}</span>
        <button type="button" onClick={() => setPaletteOpen(true)}>
          Search
        </button>
      </main>
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        stopRunAvailable={stopRunAvailable}
        onStopRun={onStopRun}
        onOpenShortcuts={() => setSheetOpen(true)}
        onToggleAppearance={onToggleAppearance}
      />
      <ShortcutSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

function renderShell(
  options: { stopRunAvailable?: boolean; onStopRun?: () => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), [PROJECT]);
  client.setQueryData(queryKeys.runs(), RUNS);
  return render(
    <QueryClientProvider client={client}>
      <ModalProvider>
        <MemoryRouter initialEntries={["/tickets"]}>
          <Routes>
            <Route path="*" element={<Shell {...options} />} />
          </Routes>
        </MemoryRouter>
      </ModalProvider>
    </QueryClientProvider>,
  );
}

const modKey = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };

function press(key: string, init: KeyboardEventInit = {}, target?: Element) {
  act(() => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    (target ?? window).dispatchEvent(event);
  });
}

/** Queries are created lazily: happy-dom registers after this module loads. */
function dom() {
  return within(document.body);
}

/** happy-dom needs focus and a keyUp before React sees the typed value (see dialog-focus). */
function typeInto(el: HTMLElement, value: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    fireEvent.keyUp(el);
  });
}

function currentPath(): string {
  return dom().getByTestId("location").textContent ?? "";
}

describe("command palette (#254)", () => {
  test("Mod+K opens the palette, and Mod+K again closes it", () => {
    renderShell();
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
    press("k", modKey);
    expect(dom().getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    press("k", modKey);
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("the toolbar Search button opens the same palette", () => {
    renderShell();
    fireEvent.click(dom().getByRole("button", { name: "Search" }));
    expect(dom().getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  test("each item shows the keys of its registry shortcut", () => {
    renderShell();
    press("k", modKey);
    const keysOf = (name: RegExp) =>
      dom()
        .getAllByRole("option")
        .find((o) => name.test(o.textContent ?? ""))
        ?.querySelector("kbd")?.textContent ?? null;
    expect(keysOf(/Start Run/)).toBe(shortcutLabel("newRun"));
    expect(keysOf(/^Tickets/)).toBe(shortcutLabel("goQueue"));
    expect(keysOf(/Keyboard Shortcuts/)).toBe(shortcutLabel("help"));
    expect(keysOf(/Add Project/)).toBeNull();
  });

  test("lists sections, projects, runs and the Help actions", () => {
    renderShell();
    press("k", modKey);
    const options = dom()
      .getAllByRole("option")
      .map((o) => o.textContent);
    const joined = options.join("|");
    for (const label of [
      "Tickets",
      "Runs",
      "Demo App",
      "ENG-7",
      "Start Run",
      "Add Project",
      "Open Settings",
      "Documentation",
      "API Reference",
    ]) {
      expect(joined).toContain(label);
    }
  });

  test("finds a run by its ticket key and by its title", () => {
    renderShell();
    press("k", modKey);
    const input = dom().getByRole("combobox");
    typeInto(input, "ENG-12");
    expect(
      dom()
        .getAllByRole("option")
        .map((o) => o.textContent)
        .join("|"),
    ).toContain("ENG-12");
    typeInto(input, "webhook");
    expect(dom().getAllByRole("option")).toHaveLength(1);
    expect(dom().getByRole("option").textContent).toContain("ENG-7");
  });

  test("Return opens the highlighted run and closes the palette", () => {
    renderShell();
    press("k", modKey);
    const input = dom().getByRole("combobox");
    typeInto(input, "ENG-12");
    act(() => {
      input.focus();
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(currentPath()).toBe("/runs/run-2");
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("arrow keys move the highlighted item", () => {
    renderShell();
    press("k", modKey);
    const input = dom().getByRole("combobox");
    const before = input.getAttribute("aria-activedescendant");
    act(() => {
      input.focus();
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(input.getAttribute("aria-activedescendant")).not.toBe(before);
  });

  test("Stop Run is offered only on a run page where the run can stop", () => {
    const { unmount } = renderShell();
    press("k", modKey);
    expect(dom().queryByText("Stop Run")).toBeNull();
    unmount();
    renderShell({ stopRunAvailable: true });
    press("k", modKey);
    expect(dom().getByText("Stop Run")).toBeTruthy();
  });

  /** Opens the palette, narrows it to one item and picks it by clicking. */
  function pick(query: string) {
    press("k", modKey);
    typeInto(dom().getByRole("combobox"), query);
    const [option] = dom().getAllByRole("option");
    if (!option) throw new Error(`no palette item for "${query}"`);
    fireEvent.click(option);
  }

  test("picking Stop Run asks the run's confirmation and closes the palette", () => {
    let stopped = 0;
    renderShell({ stopRunAvailable: true, onStopRun: () => stopped++ });
    pick("Stop Run");
    expect(stopped).toBe(1);
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  test("picking Keyboard Shortcuts opens the ? sheet", () => {
    renderShell();
    pick("Keyboard Shortcuts");
    expect(
      dom().getByRole("dialog", { name: /keyboard shortcuts/i }),
    ).toBeTruthy();
  });

  test("Help items open in a new tab", () => {
    const open = spyOn(window, "open").mockImplementation(() => null);
    try {
      renderShell();
      pick("API Reference");
      expect(open).toHaveBeenCalledTimes(1);
      expect(String(open.mock.calls[0]?.[1])).toBe("_blank");
    } finally {
      open.mockRestore();
    }
  });

  test("picking Start Run or Add Project closes the palette and stays on the page", () => {
    renderShell();
    pick("Start Run");
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
    pick("Add Project");
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect(currentPath()).toBe("/tickets");
  });

  test("ArrowUp from the first item wraps to the last, and hovering highlights an item", () => {
    renderShell();
    press("k", modKey);
    const input = dom().getByRole("combobox");
    const options = dom().getAllByRole("option");
    act(() => {
      input.focus();
      fireEvent.keyDown(input, { key: "ArrowUp" });
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[options.length - 1]?.id ?? "",
    );
    const second = options[1];
    if (!second) throw new Error("expected at least two items");
    fireEvent.mouseMove(second);
    expect(input.getAttribute("aria-activedescendant")).toBe(second.id);
  });

  test("says when nothing matches, and Return does nothing", () => {
    renderShell();
    press("k", modKey);
    const input = dom().getByRole("combobox");
    typeInto(input, "zzz-no-such-thing");
    expect(dom().getByRole("status").textContent).toContain("No matches");
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(currentPath()).toBe("/tickets");
    expect(dom().getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  test("Escape closes the palette", () => {
    renderShell();
    press("k", modKey);
    fireEvent.keyDown(dom().getByRole("combobox"), { key: "Escape" });
    expect(dom().queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });
});

describe("global shortcuts (#254)", () => {
  test("G then T goes to Tickets; G then R goes to Runs", () => {
    renderShell();
    press("g");
    press("r");
    expect(currentPath()).toBe("/runs");
    press("g");
    press("t");
    expect(currentPath()).toBe("/tickets");
  });

  test("single keys are ignored while a text field has focus", () => {
    renderShell();
    // A plain input outside React's tree: React's own event handling does not run
    // for it under happy-dom, so the test checks only the shortcut guard.
    const field = document.createElement("input");
    field.type = "text";
    document.body.appendChild(field);
    press("g", {}, field);
    press("r", {}, field);
    expect(currentPath()).toBe("/tickets");
    press("?", { shiftKey: true }, field);
    expect(
      dom().queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeNull();
    field.remove();
  });

  test("? opens the shortcut sheet, which lists the registry", () => {
    renderShell();
    press("?", { shiftKey: true });
    const sheet = dom().getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(sheet.textContent).toContain("Command palette");
    expect(sheet.textContent).toContain("Stop run");
  });

  test("/ focuses the page's search field", () => {
    renderShell();
    const search = dom().getByLabelText("Ticket filter");
    press("/");
    expect(document.activeElement).toBe(search);
  });

  test("Escape closes the ? sheet", () => {
    renderShell();
    press("?", { shiftKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      dom().queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeNull();
  });
});
