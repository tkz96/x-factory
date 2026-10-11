// test/frontend-theme.test.ts — One appearance for the whole app (#248): every
// component reads the same value, a change reaches them all, storage only
// mirrors the choice, and failing storage never breaks the theme.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { setAppearance, useTheme } from "../src/frontend/hooks/useTheme.js";

function Probe({ id }: { id: string }) {
  const { appearance, resolvedAppearance } = useTheme();
  return React.createElement(
    "span",
    { "data-testid": id },
    `${appearance}/${resolvedAppearance}`,
  );
}

afterEach(() => {
  cleanup();
  act(() => setAppearance("automatic"));
});
afterAll(async () => {
  await unregisterHappyDom();
});

describe("shared appearance (#248)", () => {
  it("a change made in one component reaches every other one and the document", () => {
    const { getByTestId } = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Probe, { id: "shell" }),
        React.createElement(Probe, { id: "diagram" }),
      ),
    );

    act(() => setAppearance("dark"));

    expect(getByTestId("shell").textContent).toBe("dark/dark");
    expect(getByTestId("diagram").textContent).toBe("dark/dark");
    expect(document.documentElement.getAttribute("data-appearance")).toBe(
      "dark",
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("default");
    expect(localStorage.getItem("xf_appearance")).toBe("dark");
  });

  it("toggling flips what is showing and returns the new choice", () => {
    let toggle: (() => string) | undefined;
    function Toggler() {
      toggle = useTheme().toggleTheme;
      return null;
    }
    const { getByTestId } = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Toggler),
        React.createElement(Probe, { id: "probe" }),
      ),
    );
    act(() => setAppearance("light"));

    let next: string | undefined;
    act(() => {
      next = toggle?.();
    });
    expect(next).toBe("dark");
    expect(getByTestId("probe").textContent).toBe("dark/dark");
  });

  it("storage that throws on every call never breaks applying the appearance", () => {
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
    try {
      const { getByTestId } = render(React.createElement(Probe, { id: "p" }));
      act(() => setAppearance("light"));
      expect(getByTestId("p").textContent).toBe("light/light");
    } finally {
      Storage.prototype.setItem = realSet;
    }
  });
});
