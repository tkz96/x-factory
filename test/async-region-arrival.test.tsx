// test/async-region-arrival.test.tsx — content that arrives after a wait fades
// in; content rendered from the cache does not (UI round 2, motion C2).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AsyncRegion } from "../src/frontend/components/feedback/AsyncRegion.js";
import type { DerivedAsyncState } from "../src/frontend/components/feedback/types.js";

afterEach(() => cleanup());
afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

const state = (s: DerivedAsyncState["state"]): DerivedAsyncState => ({
  state: s,
  suppressed: [],
  error: undefined,
});

function region(container: HTMLElement): Element {
  const el = container.querySelector(".async-region");
  if (el === null) throw new Error("no async region rendered");
  return el;
}

describe("AsyncRegion arrival", () => {
  it("fades ready content in after a loading state", () => {
    const view = render(
      <AsyncRegion derived={state("loading")} placeholderRows={3}>
        <p>rows</p>
      </AsyncRegion>,
    );
    expect(region(view.container).className).toContain("async-region--loading");
    view.rerender(
      <AsyncRegion derived={state("ready")} placeholderRows={3}>
        <p>rows</p>
      </AsyncRegion>,
    );
    expect(region(view.container).className).toContain("async-region--arrived");
  });

  it("fades an empty result in after a loading state", () => {
    const view = render(
      <AsyncRegion derived={state("loading")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    view.rerender(
      <AsyncRegion derived={state("empty")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    expect(region(view.container).className).toContain("async-region--arrived");
  });

  it("shows cached content at once, with no fade", () => {
    const view = render(
      <AsyncRegion derived={state("ready")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    expect(region(view.container).className).not.toContain(
      "async-region--arrived",
    );
  });

  it("does not fade content again on a background refresh", () => {
    const view = render(
      <AsyncRegion derived={state("ready")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    view.rerender(
      <AsyncRegion derived={state("stale")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    view.rerender(
      <AsyncRegion derived={state("ready")}>
        <p>rows</p>
      </AsyncRegion>,
    );
    expect(region(view.container).className).not.toContain(
      "async-region--arrived",
    );
  });
});
