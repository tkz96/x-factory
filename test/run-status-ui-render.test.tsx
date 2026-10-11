/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { RunHistoryCard } from "../src/frontend/components/history/RunHistoryCard.js";
import { runStatusText } from "../src/frontend/lib/run-status-ui.js";
import { TRANSITIONS } from "../src/shared/run-status-policy.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

describe("run status wording on screen", () => {
  it("renders the plain label, never the raw status, for every status", () => {
    for (const status of Object.keys(TRANSITIONS) as RunStatus[]) {
      const run = {
        id: "r1",
        status,
        branch: "b",
        startedAt: null,
        ticket: { id: "T-1", title: "Title" },
        project: { id: "p", name: "P" },
      } as unknown as Run;
      const { container, unmount } = render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(RunHistoryCard, { run }),
        ),
      );
      const text = container.textContent ?? "";
      expect(text).toContain(runStatusText(status));
      expect(text).not.toContain(status);
      unmount();
    }
  });
});
