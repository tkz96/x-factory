// test/dialog-focus.test.tsx — Focus management contract for every dialog (#245).
//
// Each dialog (shared Modal, diff, diagram, new run) must: move focus in on open,
// trap Tab inside, make the rest of the page inert, restore focus to the trigger
// on close, and close on Escape.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { DiagramModal } from "../src/frontend/components/diagrams/DiagramModal.js";
import {
  DIAGRAM_REGISTRY,
  type DiagramDefinition,
} from "../src/frontend/components/diagrams/registry.js";
import { Modal } from "../src/frontend/components/Modal.js";
import { NewRunModal } from "../src/frontend/components/modals/NewRunModal.js";
import { DiffModal } from "../src/frontend/components/runs/DiffModal.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";

/** A page with a trigger button; the dialog under test opens from it. */
function Page({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main id="app-root">
        <button type="button" id="trigger" onClick={() => setOpen(true)}>
          Open
        </button>
      </main>
      {open ? children(() => setOpen(false)) : null}
    </>
  );
}

function NewRunHarness() {
  const { openNewRunModal } = useModal();
  return (
    <main id="app-root">
      <button type="button" id="trigger" onClick={() => openNewRunModal()}>
        Open
      </button>
      <NewRunModal />
    </main>
  );
}

const anyDiagram = Object.values(DIAGRAM_REGISTRY)[0] as DiagramDefinition;

const dialogs: {
  name: string;
  ui: () => ReactNode;
  dialogSelector: string;
}[] = [
  {
    name: "Modal",
    dialogSelector: "#m-overlay",
    ui: () => (
      <Page>
        {(close) => (
          <Modal id="m" title="Shared" onClose={close}>
            <input id="m-input" aria-label="Name" />
          </Modal>
        )}
      </Page>
    ),
  },
  {
    name: "DiffModal",
    dialogSelector: "#diff-modal-backdrop",
    ui: () => (
      <Page>
        {(close) => (
          <DiffModal
            isOpen
            file="a.ts"
            added={1}
            removed={0}
            hunks={"@@ -1 +1 @@\n+x"}
            onClose={close}
          />
        )}
      </Page>
    ),
  },
  {
    name: "DiagramModal",
    dialogSelector: ".flow-modal-backdrop",
    ui: () => (
      <Page>
        {(close) => (
          <DiagramModal diagram={anyDiagram} colorMode="dark" onClose={close} />
        )}
      </Page>
    ),
  },
  {
    name: "NewRunModal",
    dialogSelector: "#modal-new-run",
    ui: () => (
      <QueryClientProvider client={new QueryClient()}>
        <ProjectProvider>
          <ModalProvider>
            <MemoryRouter>
              <NewRunHarness />
            </MemoryRouter>
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>
    ),
  },
];

function open(ui: ReactNode, dialogSelector: string) {
  const view = render(ui);
  const trigger = document.getElementById("trigger") as HTMLElement;
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const dialog = document.querySelector(dialogSelector) as HTMLElement;
  return { view, trigger, dialog };
}

function tab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Tab",
    shiftKey: shift,
  });
}

describe("dialog focus management (#245)", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });
  afterAll(async () => {
    await unregisterHappyDom();
  });

  for (const { name, ui, dialogSelector } of dialogs) {
    describe(name, () => {
      it("moves focus into the dialog on open", async () => {
        const { dialog } = open(ui(), dialogSelector);
        expect(dialog).not.toBeNull();
        // Focus lands on the dialog's own effect: wait for it rather than sample once.
        await waitFor(() =>
          expect(dialog.contains(document.activeElement)).toBe(true),
        );
      });

      it("makes the background inert while open and not after", () => {
        const { dialog } = open(ui(), dialogSelector);
        expect(
          document.getElementById("app-root")?.closest("[inert]"),
        ).not.toBeNull();
        expect(dialog.closest("[inert]")).toBeNull();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(document.querySelector("[inert]")).toBeNull();
      });

      it("traps Tab and Shift+Tab inside the dialog", () => {
        const { dialog } = open(ui(), dialogSelector);
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex]:not([tabindex='-1'])",
          ),
        );
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        act(() => last.focus());
        tab();
        expect(document.activeElement).toBe(first);
        tab(true);
        expect(document.activeElement).toBe(last);
      });

      it("restores focus to the trigger and closes on Escape", () => {
        const { trigger } = open(ui(), dialogSelector);
        fireEvent.keyDown(window, { key: "Escape" });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
      });
    });
  }
});
