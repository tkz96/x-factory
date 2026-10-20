// test/run-split-handle.test.tsx — The run page's resizable split: the divider's keyboard and pointer
// behaviour, the clamp to 20 to 80, the custom property that sets the chat's width, and browser
// storage that may be blocked (#241, the run page split).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { RunSplitHandle } from "../src/frontend/components/runs/RunSplitHandle.js";
import {
  RUN_SPLIT_STORAGE_KEY,
  useRunSplit,
} from "../src/frontend/components/runs/useRunSplit.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

/** The same wiring the run page uses: a layout that holds the chat, the divider and the pane. */
function SplitHarness() {
  const layoutRef = useRef<HTMLDivElement>(null);
  const { split, setSplit, resetSplit } = useRunSplit();
  return (
    <div
      ref={layoutRef}
      className="run-detail-layout run-detail-layout--split"
      data-testid="layout"
      style={{ "--run-split": `${split}%` } as CSSProperties}
    >
      <div className="run-detail-main" />
      <RunSplitHandle
        containerRef={layoutRef}
        split={split}
        onSplit={setSplit}
        onReset={resetSplit}
      />
      <aside className="run-inspector" />
    </div>
  );
}

function renderHarness() {
  const utils = render(<SplitHarness />);
  const layout = utils.getByTestId("layout");
  const handle = utils.getByRole("separator", { name: "Resize panels" });
  return { ...utils, layout, handle };
}

function splitOf(handle: HTMLElement): string | null {
  return handle.getAttribute("aria-valuenow");
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("the divider is an accessible vertical separator", () => {
  it("starts at 50 and exposes the 20 to 80 range", () => {
    const { handle } = renderHarness();
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuemin")).toBe("20");
    expect(handle.getAttribute("aria-valuemax")).toBe("80");
    expect(splitOf(handle)).toBe("50");
    expect(handle.getAttribute("tabindex")).toBe("0");
  });
});

describe("keyboard control", () => {
  it("moves 5 percent with the arrow keys", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(splitOf(handle)).toBe("45");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(splitOf(handle)).toBe("55");
  });

  it("jumps to 20 on Home and 80 on End", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "Home" });
    expect(splitOf(handle)).toBe("20");
    fireEvent.keyDown(handle, { key: "End" });
    expect(splitOf(handle)).toBe("80");
  });

  it("clamps at 20 and 80", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(splitOf(handle)).toBe("80");
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(splitOf(handle)).toBe("20");
  });

  it("restores 50 on Enter", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(splitOf(handle)).toBe("50");
  });

  it("restores 50 on a double-click", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.doubleClick(handle);
    expect(splitOf(handle)).toBe("50");
  });

  it("ignores keys it does not use", () => {
    const { handle } = renderHarness();
    fireEvent.keyDown(handle, { key: "a" });
    expect(splitOf(handle)).toBe("50");
  });
});

describe("the split reaches the layout", () => {
  it("sets the chat's width as a custom property that follows the split", () => {
    const { layout, handle } = renderHarness();
    expect(layout.style.getPropertyValue("--run-split")).toBe("50%");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(layout.style.getPropertyValue("--run-split")).toBe("45%");
    fireEvent.keyDown(handle, { key: "End" });
    expect(layout.style.getPropertyValue("--run-split")).toBe("80%");
  });
});

describe("pointer drag", () => {
  it("moves the split to the pointer's share of the layout and marks the page while dragging", () => {
    const { layout, handle } = renderHarness();
    layout.getBoundingClientRect = () =>
      ({
        left: 100,
        width: 1000,
        top: 0,
        height: 0,
        right: 1100,
        bottom: 0,
      }) as DOMRect;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 });
    expect(layout.getAttribute("data-resizing")).not.toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(splitOf(handle)).toBe("60");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1200 });
    expect(splitOf(handle)).toBe("80");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 1200 });
    expect(layout.getAttribute("data-resizing")).toBeNull();
  });

  it("ignores moves after the drag ends", () => {
    const { layout, handle } = renderHarness();
    layout.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 1000,
        top: 0,
        height: 0,
        right: 1000,
        bottom: 0,
      }) as DOMRect;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250 });
    expect(splitOf(handle)).toBe("50");
  });
});

describe("browser storage", () => {
  it("remembers the split and reads it back on the next visit", () => {
    const first = renderHarness();
    fireEvent.keyDown(first.handle, { key: "ArrowLeft" });
    expect(window.localStorage.getItem(RUN_SPLIT_STORAGE_KEY)).toBe("45");
    first.unmount();

    const second = renderHarness();
    expect(splitOf(second.handle)).toBe("45");
  });

  it("falls back to 50 for a stored value outside the range", () => {
    window.localStorage.setItem(RUN_SPLIT_STORAGE_KEY, "95");
    const { handle } = renderHarness();
    expect(splitOf(handle)).toBe("80");
  });

  it("does not throw when the store is blocked", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
    try {
      const { handle } = renderHarness();
      expect(splitOf(handle)).toBe("50");
      expect(() =>
        fireEvent.keyDown(handle, { key: "ArrowRight" }),
      ).not.toThrow();
      expect(splitOf(handle)).toBe("55");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as unknown as Record<string, unknown>).localStorage;
    }
  });
});
