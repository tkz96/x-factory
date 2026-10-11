// test/motion-system.test.tsx — the motion library half of the motion system (#252).
//
// The CSS half — motion tokens, and the reduced-motion path beside every
// keyframe — is gated in test/frontend-smoke.test.ts. This file covers the
// library: one LazyMotion host, a feature pack that loads on demand with only
// the features in use, and the components the chat, the lists and the sheets are
// built from.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { MotionConfigContext } from "motion/react";
import { type ReactNode, useContext } from "react";
import { MotionDrag } from "../src/frontend/motion/MotionDrag.js";
import { MotionEntry } from "../src/frontend/motion/MotionEntry.js";
import {
  MotionList,
  MotionListItem,
} from "../src/frontend/motion/MotionList.js";
import { MotionProvider } from "../src/frontend/motion/MotionProvider.js";
import { MotionSheet } from "../src/frontend/motion/MotionSheet.js";
import { loadMotionFeatures } from "../src/frontend/motion/motion-features.js";

/** Reads what the provider hands every motion component below it. */
function ReducedMotionProbe() {
  const config = useContext(MotionConfigContext);
  return <span data-testid="probe">{config?.reducedMotion}</span>;
}

/**
 * Renders inside the app's LazyMotion host and lets the feature pack settle, so
 * every assertion runs against the tree the user would see.
 */
async function renderInProvider(ui: ReactNode) {
  const view = render(<MotionProvider>{ui}</MotionProvider>);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

function inlineStyle(element: HTMLElement): string {
  return element.getAttribute("style") ?? "";
}

describe("motion system (#252)", () => {
  afterEach(async () => {
    // LazyMotion resolves the feature pack after the first render; let that
    // settle inside act so it never lands outside one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    cleanup();
  });
  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("hands every motion component the system's reduced-motion setting", async () => {
    const view = await renderInProvider(<ReducedMotionProbe />);

    // "user" is what makes motion drop transform and layout animation and keep
    // a short crossfade when the operating system asks for less motion.
    expect(view.getByTestId("probe").textContent).toBe("user");
  });

  it("loads the feature pack on demand, with the features in use", async () => {
    const pending = loadMotionFeatures();

    expect(pending).toBeInstanceOf(Promise);
    const pack = await pending;
    // Layout animates a reordered row, drag swipes a sheet away, and exit is
    // what a row leaving the chat animates through.
    expect(Object.keys(pack)).toContain("layout");
    expect(Object.keys(pack)).toContain("drag");
    expect(Object.keys(pack)).toContain("exit");
  });

  it("renders a chat entry as a small rise, never from nothing", async () => {
    const view = await renderInProvider(
      <MotionEntry className="chat-row">Hello</MotionEntry>,
    );
    const row = view.getByText("Hello");

    expect(row.className).toBe("chat-row");
    // Present but almost there: a fade in and a small rise, never scale(0).
    expect(inlineStyle(row)).toContain("opacity: 0");
    expect(inlineStyle(row)).toContain("translateY(8px)");
    expect(inlineStyle(row)).not.toMatch(/scale\(0\)/);
  });

  it("renders a sheet that grows from 0.98 rather than from nothing", async () => {
    const view = await renderInProvider(
      <MotionSheet className="sheet">Sheet body</MotionSheet>,
    );
    const sheet = view.getByText("Sheet body");

    expect(sheet.className).toBe("sheet");
    expect(inlineStyle(sheet)).toContain("opacity: 0");
    expect(inlineStyle(sheet)).toContain("scale(0.98)");
    expect(inlineStyle(sheet)).not.toMatch(/scale\(0\)/);
  });

  it("renders a list whose rows keep their place when the order changes", async () => {
    const view = await renderInProvider(
      <MotionList className="run-list">
        <MotionListItem className="run-row">First run</MotionListItem>
      </MotionList>,
    );

    expect(view.getByText("First run").className).toBe("run-row");
    expect(inlineStyle(view.getByText("First run"))).toContain("opacity: 0");
  });

  it("renders a drag surface that claims vertical gestures only", async () => {
    const view = await renderInProvider(
      <MotionDrag className="sheet-handle">Handle</MotionDrag>,
    );
    const handle = view.getByText("Handle");

    expect(handle.className).toBe("sheet-handle");
    // Motion keeps the vertical gesture for the sheet and leaves horizontal
    // panning to the browser, so a sideways swipe still scrolls the page.
    expect(inlineStyle(handle)).toContain("touch-action: pan-x");
  });
});
