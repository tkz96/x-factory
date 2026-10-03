// test/feedback-countdown.test.ts — Rate-limit timed guidance (#129, spec
// #133 user story 26): the retry affordance stays disabled behind countdown
// copy and un-disables itself once the rate-limit window elapses.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { FeedbackBanner } from "../src/frontend/components/feedback/FeedbackBanner.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

describe("FeedbackBanner — rate-limit timed guidance", () => {
  it("disables the retry behind countdown copy, then un-disables it when the window elapses", async () => {
    const { container, unmount } = render(
      React.createElement(FeedbackBanner, {
        tone: "error",
        message: "The provider is limiting requests.",
        retryAfterMs: 1100,
        onRetry: () => {},
      }),
    );

    const button = () =>
      container.querySelector<HTMLButtonElement>("button.retry-action");

    // Initial render: retry disabled behind timed guidance.
    expect(button()?.disabled).toBe(true);
    expect(container.textContent).toContain("Retry available in 2s");

    // The window elapses (~2s at a 1s tick) and the retry un-disables itself.
    await waitFor(
      () => {
        if (button()?.disabled !== false) {
          throw new Error("retry still disabled");
        }
      },
      { timeout: 6000, interval: 200 },
    );
    expect(container.textContent).not.toContain("Retry available");

    unmount();
  });
});
