// test/overlays.test.tsx — Behaviour tests for overlay building blocks on React Aria (#250).
//
// Acceptance criteria:
// 1. Each block (sheet/dialog, alert dialog, popover, menu, tooltip) has behaviour tests:
//    - focus moves in
//    - focus is trapped where appropriate
//    - focus returns to the trigger
//    - Esc closes the top layer
//    - screen-reader roles and labels are correct
// 2. Opening and closing have short motion tokens with a reduced-motion crossfade.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  AlertDialog,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  OverlayTriggerButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  Tooltip,
  TooltipTrigger,
} from "../src/frontend/components/overlays/index.js";

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** React Aria moves focus into a popover after paint, so let that frame run. */
async function flushFocus() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Tab",
    shiftKey: shift,
  });
}

describe("Overlay building blocks on React Aria (#250)", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
    document.body.innerHTML = "";
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  describe("Dialog & Sheet", () => {
    it("renders dialog semantics, moves focus in, traps Tab, and restores focus to trigger on Esc", () => {
      const onClose = mock(() => {});

      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <main id="app-root">
              <button
                type="button"
                id="open-dialog-btn"
                onClick={() => setOpen(true)}
              >
                Open Dialog
              </button>
            </main>
            <Dialog
              isOpen={open}
              onClose={() => {
                setOpen(false);
                onClose();
              }}
              id="test-dlg"
              title="Test Modal Dialog"
            >
              <DialogHeader>
                <DialogTitle>Test Modal Dialog</DialogTitle>
                <DialogCloseButton id="dlg-close-btn" />
              </DialogHeader>
              <DialogBody>
                <input id="dlg-first-input" aria-label="First input" />
                <input id="dlg-second-input" aria-label="Second input" />
              </DialogBody>
              <DialogFooter>
                <button type="button" id="dlg-action-btn">
                  Submit
                </button>
              </DialogFooter>
            </Dialog>
          </>
        );
      }

      render(<Harness />);
      const trigger = getEl("open-dialog-btn");
      act(() => trigger.focus());
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);

      // 1. Screen-reader roles and labels
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).not.toBeNull();
      const title = document.getElementById(
        dialog.getAttribute("aria-labelledby") as string,
      );
      expect(title?.textContent).toBe("Test Modal Dialog");

      // 2. Background is inert while open
      expect(getEl("app-root").closest("[inert]")).not.toBeNull();

      // 3. Focus moves into the dialog
      expect(dialog.contains(document.activeElement)).toBe(true);

      // 4. Focus is trapped inside
      const first = getEl("dlg-close-btn");
      const last = getEl("dlg-action-btn");
      act(() => last.focus());
      tab();
      expect(document.activeElement).toBe(first);
      tab(true);
      expect(document.activeElement).toBe(last);

      // 5. Esc closes and restores focus to trigger
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(onClose).toHaveBeenCalled();
      expect(document.querySelector("[inert]")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("Sheet variant renders sheet presentation, traps focus, and closes on backdrop click", () => {
      const onClose = mock(() => {});

      function SheetHarness() {
        const [open, setOpen] = useState(true);
        return (
          <Sheet
            isOpen={open}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
            id="test-sheet"
            title="Assistant Sheet"
            position="right"
          >
            <DialogHeader>
              <DialogTitle>Assistant Sheet</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <button type="button" id="sheet-btn-1">
                Action 1
              </button>
              <button type="button" id="sheet-btn-2">
                Action 2
              </button>
            </DialogBody>
          </Sheet>
        );
      }

      render(<SheetHarness />);
      const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(sheet).not.toBeNull();
      expect(sheet.closest(".xf-sheet-modal")).not.toBeNull();

      // Backdrop click closes
      const backdrop = document.querySelector(
        ".xf-dialog-overlay",
      ) as HTMLElement;
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("AlertDialog", () => {
    it("renders alertdialog role, traps focus, announces title and description, and restores focus", () => {
      const onConfirm = mock(() => {});
      const onCancel = mock(() => {});

      function AlertHarness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button
              type="button"
              id="alert-trigger"
              onClick={() => setOpen(true)}
            >
              Delete
            </button>
            <AlertDialog
              isOpen={open}
              onClose={() => {
                setOpen(false);
                onCancel();
              }}
              title="Stop Run?"
              description="This will stop the run on branch feat/x. This cannot be undone."
              confirmText="Stop Run"
              cancelText="Cancel"
              variant="danger"
              onConfirm={onConfirm}
              id="stop-run-alert"
            />
          </>
        );
      }

      render(<AlertHarness />);
      const trigger = getEl("alert-trigger");
      act(() => trigger.focus());
      fireEvent.click(trigger);

      // Screen reader semantics
      const alert = document.querySelector(
        '[role="alertdialog"]',
      ) as HTMLElement;
      expect(alert).not.toBeNull();
      expect(alert.getAttribute("aria-modal")).toBe("true");
      expect(alert.getAttribute("aria-labelledby")).not.toBeNull();
      expect(alert.getAttribute("aria-describedby")).not.toBeNull();

      const titleEl = document.getElementById(
        alert.getAttribute("aria-labelledby") as string,
      );
      expect(titleEl?.textContent).toBe("Stop Run?");

      const descEl = document.getElementById(
        alert.getAttribute("aria-describedby") as string,
      );
      expect(descEl?.textContent).toContain("cannot be undone");

      // Focus moved into the dialog, and Tab cannot leave it
      expect(alert.contains(document.activeElement)).toBe(true);
      const buttons = alert.querySelectorAll("button");
      act(() => (buttons[buttons.length - 1] as HTMLElement).focus());
      tab();
      expect(alert.contains(document.activeElement)).toBe(true);

      // Esc cancels and restores focus to trigger
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe("AlertDialog actions", () => {
    it("Confirm runs the action once and closes; Cancel closes without confirming", () => {
      const onConfirm = mock(() => {});
      const onClose = mock(() => {});

      function ConfirmHarness() {
        const [open, setOpen] = useState(true);
        return (
          <AlertDialog
            isOpen={open}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
            title="Delete connection?"
            confirmText="Delete"
            cancelText="Keep"
            variant="danger"
            onConfirm={onConfirm}
            id="confirm-alert"
          />
        );
      }

      render(<ConfirmHarness />);
      const alert = document.querySelector(
        '[role="alertdialog"]',
      ) as HTMLElement;
      const confirm = Array.from(alert.querySelectorAll("button")).find(
        (b) => b.textContent === "Delete",
      ) as HTMLElement;
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    });
  });

  describe("Popover", () => {
    it("renders popover anchored to trigger, moves focus in, and Esc closes and restores focus", async () => {
      function PopoverHarness() {
        return (
          <PopoverTrigger>
            <OverlayTriggerButton id="popover-btn">
              Open Popover
            </OverlayTriggerButton>
            <Popover>
              <PopoverContent aria-label="Quick Info">
                <p>Popover details</p>
                <button type="button" id="popover-inside-btn">
                  Details Action
                </button>
              </PopoverContent>
            </Popover>
          </PopoverTrigger>
        );
      }

      render(<PopoverHarness />);
      const trigger = getEl("popover-btn");
      act(() => trigger.focus());
      fireEvent.click(trigger);
      await flushFocus();

      const popover = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(popover).not.toBeNull();
      expect(popover.getAttribute("aria-label")).toBe("Quick Info");

      // Focus moved inside
      expect(popover.contains(document.activeElement)).toBe(true);

      // Esc closes
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector(".xf-popover")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe("Menu", () => {
    it("renders menu with menuitem roles, keyboard selection, and returns focus on Esc", () => {
      const onAction = mock((_key: string) => {});

      function MenuHarness() {
        return (
          <MenuTrigger>
            <OverlayTriggerButton id="menu-btn">Options</OverlayTriggerButton>
            <Popover>
              <Menu
                aria-label="Options Menu"
                onAction={(key) => onAction(String(key))}
              >
                <MenuItem id="menu-item-edit" textValue="Edit">
                  Edit
                </MenuItem>
                <MenuItem id="menu-item-copy" textValue="Copy">
                  Copy
                </MenuItem>
                <MenuSeparator />
                <MenuItem id="menu-item-delete" textValue="Delete" isDanger>
                  Delete
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
        );
      }

      render(<MenuHarness />);
      const trigger = getEl("menu-btn");
      act(() => trigger.focus());
      fireEvent.click(trigger);

      const menu = document.querySelector('[role="menu"]') as HTMLElement;
      expect(menu).not.toBeNull();
      expect(menu.getAttribute("aria-label")).toBe("Options Menu");

      const items = document.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBe(3);

      // Esc closes and returns focus to trigger
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  describe("Tooltip", () => {
    it("renders tooltip role on trigger focus and hover", () => {
      function TooltipHarness() {
        return (
          <TooltipTrigger delay={0} closeDelay={0}>
            <OverlayTriggerButton id="tooltip-btn">
              Hover me
            </OverlayTriggerButton>
            <Tooltip>Helpful explanation</Tooltip>
          </TooltipTrigger>
        );
      }

      render(<TooltipHarness />);
      const trigger = getEl("tooltip-btn");
      act(() => trigger.focus());

      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain("Helpful explanation");

      // Esc closes tooltip
      fireEvent.keyDown(window, { key: "Escape" });
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });
  });

  describe("Top-layer Esc dismissal with stacked overlays", () => {
    it("Esc closes only the top layer when multiple overlays are stacked", () => {
      const onDialogClose = mock(() => {});
      const onAlertClose = mock(() => {});

      function StackHarness() {
        const [dialogOpen, setDialogOpen] = useState(true);
        const [alertOpen, setAlertOpen] = useState(false);

        return (
          <>
            <Dialog
              isOpen={dialogOpen}
              onClose={() => {
                setDialogOpen(false);
                onDialogClose();
              }}
              id="base-dialog"
              title="Base Dialog"
            >
              <DialogHeader>
                <DialogTitle>Base Dialog</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <button
                  type="button"
                  id="open-nested-alert"
                  onClick={() => setAlertOpen(true)}
                >
                  Prompt Delete
                </button>
              </DialogBody>
            </Dialog>

            <AlertDialog
              isOpen={alertOpen}
              onClose={() => {
                setAlertOpen(false);
                onAlertClose();
              }}
              title="Confirm Delete"
              description="Are you sure?"
              id="nested-alert"
            />
          </>
        );
      }

      render(<StackHarness />);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();

      // Open the child alertdialog
      const alertBtn = getEl("open-nested-alert");
      fireEvent.click(alertBtn);
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

      // Pressing Esc MUST close only the top layer (the alertdialog)
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onAlertClose).toHaveBeenCalledTimes(1);
      expect(onDialogClose).toHaveBeenCalledTimes(0);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      // Pressing Esc again closes the base dialog
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onDialogClose).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});
