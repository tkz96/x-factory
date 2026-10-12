// test/overlay-exit-motion.test.tsx — Overlays animate when they close (#250).
//
// React Aria keeps an overlay in the DOM while its exit animation runs, marks it
// `data-exiting`, and unmounts it when that animation ends. These tests pin both halves
// of that contract for each block: the overlay survives the close while the animation
// runs, and it is gone once the animation is over. happy-dom applies no stylesheet, so
// nothing ever plays there and a close ends in the same tick — the behaviour the
// unchanged suites in overlays.test.tsx and dialog-focus.test.tsx rely on, and the last
// test here states it outright. The exit animation itself is a browser fact, proven in
// test/overlay-exit-browser.test.ts.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  OverlayTriggerButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  Tooltip,
  TooltipTrigger,
} from "../src/frontend/components/overlays/index.js";
import {
  type ExitAnimationWatch,
  watchExitAnimations,
} from "./helpers/overlay-exit-animations.js";

const DIALOG_ANIMATIONS = ".xf-dialog-overlay, .xf-dialog-modal";

/** React Aria moves focus into a popover after paint, so let that frame run. */
async function flushFocus() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Ends the exit animation and lets the overlay leave. */
async function release(gate: { finish: () => void }) {
  await act(async () => {
    gate.finish();
    await Promise.resolve();
  });
}

describe("Overlays animate when they close (#250)", () => {
  let watch: ExitAnimationWatch | null = null;

  afterEach(() => {
    watch?.restore();
    watch = null;
    cleanup();
    document.body.style.overflow = "";
    document.body.innerHTML = "";
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("keeps a dialog mounted, marked data-exiting, until its exit animation ends", async () => {
    watch = watchExitAnimations(DIALOG_ANIMATIONS);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          isOpen={open}
          onClose={() => setOpen(false)}
          id="exit-dialog"
          title="Closing Dialog"
        >
          <DialogHeader>
            <DialogTitle>Closing Dialog</DialogTitle>
          </DialogHeader>
        </Dialog>
      );
    }

    render(<Harness />);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const gate = (watch as ExitAnimationWatch).arm();
    fireEvent.keyDown(window, { key: "Escape" });

    // The close is in flight: the overlay and its surface are still in the DOM, and
    // React Aria's exiting state is what the exit animation keys off.
    const overlay = document.querySelector(".xf-dialog-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.hasAttribute("data-exiting")).toBe(true);
    expect(
      document.querySelector(".xf-dialog-modal")?.hasAttribute("data-exiting"),
    ).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await release(gate);
    expect(document.querySelector(".xf-dialog-overlay")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a sheet in place, marked data-exiting, until its exit animation ends", async () => {
    watch = watchExitAnimations(DIALOG_ANIMATIONS);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet
          isOpen={open}
          onClose={() => setOpen(false)}
          id="exit-sheet"
          title="Closing Sheet"
          position="right"
        >
          <DialogHeader>
            <DialogTitle>Closing Sheet</DialogTitle>
          </DialogHeader>
        </Sheet>
      );
    }

    render(<Harness />);
    expect(document.querySelector(".xf-sheet-right")).not.toBeNull();

    const gate = (watch as ExitAnimationWatch).arm();
    fireEvent.keyDown(window, { key: "Escape" });

    const sheet = document.querySelector(".xf-sheet-right");
    expect(sheet).not.toBeNull();
    expect(sheet?.closest("[data-exiting]")).not.toBeNull();

    await release(gate);
    expect(document.querySelector(".xf-sheet-right")).toBeNull();
  });

  it("keeps a popover mounted, marked data-exiting, until its exit animation ends", async () => {
    watch = watchExitAnimations(".xf-popover");

    function Harness() {
      return (
        <PopoverTrigger>
          <OverlayTriggerButton id="exit-popover-btn">
            Open Popover
          </OverlayTriggerButton>
          <Popover>
            <PopoverContent aria-label="Closing Popover">
              <p>Popover details</p>
            </PopoverContent>
          </Popover>
        </PopoverTrigger>
      );
    }

    render(<Harness />);
    fireEvent.click(document.getElementById("exit-popover-btn") as HTMLElement);
    await flushFocus();
    expect(document.querySelector(".xf-popover")).not.toBeNull();

    const gate = (watch as ExitAnimationWatch).arm();
    fireEvent.keyDown(window, { key: "Escape" });

    const popover = document.querySelector(".xf-popover");
    expect(popover).not.toBeNull();
    expect(popover?.hasAttribute("data-exiting")).toBe(true);

    await release(gate);
    expect(document.querySelector(".xf-popover")).toBeNull();
  });

  it("keeps a tooltip mounted, marked data-exiting, until its exit animation ends", async () => {
    watch = watchExitAnimations(".xf-tooltip");

    function Harness() {
      return (
        <TooltipTrigger delay={0} closeDelay={0}>
          <OverlayTriggerButton id="exit-tooltip-btn">
            Hover me
          </OverlayTriggerButton>
          <Tooltip>Helpful explanation</Tooltip>
        </TooltipTrigger>
      );
    }

    render(<Harness />);
    const trigger = document.getElementById("exit-tooltip-btn") as HTMLElement;
    act(() => trigger.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    const gate = (watch as ExitAnimationWatch).arm();
    fireEvent.keyDown(window, { key: "Escape" });

    const tooltip = document.querySelector(".xf-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.hasAttribute("data-exiting")).toBe(true);

    await release(gate);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("ends the exit wait in the same tick when the DOM reports no animation", () => {
    // happy-dom runs no CSS, so this is what every overlay behaviour test sees: with
    // nothing playing, React Aria's wait ends at once and the overlay is gone
    // synchronously. The exit animation must never hang a test.
    watch = watchExitAnimations(DIALOG_ANIMATIONS);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          isOpen={open}
          onClose={() => setOpen(false)}
          id="instant-dialog"
          title="Instant Dialog"
        >
          <DialogHeader>
            <DialogTitle>Instant Dialog</DialogTitle>
          </DialogHeader>
        </Dialog>
      );
    }

    render(<Harness />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".xf-dialog-overlay")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
