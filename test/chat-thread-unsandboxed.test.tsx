// test/chat-thread-unsandboxed.test.tsx — ChatThread and RunChat render unsandboxed attempt warnings (#275).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import type { Run, RunEvent } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterHappyDom();
});

describe("ChatThread unsandboxed warning line (#275)", () => {
  it("renders a standard text bubble for regular info events", () => {
    const regularEvent: RunEvent = {
      id: 1,
      type: "info",
      payload: { text: "Starting pipeline execution." },
      timestamp: new Date().toISOString(),
    };

    const { container } = render(
      React.createElement(ChatThread, { events: [regularEvent] }),
    );

    const bubble = container.querySelector(".chat-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.classList.contains("bubble-warning")).toBe(false);
    expect(container.textContent).toContain("Starting pipeline execution.");
    expect(container.querySelector(".chat-bubble-badge")).toBeNull();
  });

  it("renders a warning bubble with badge for unsandboxed attempt info events", () => {
    const unsandboxedEvent: RunEvent = {
      id: 2,
      type: "info",
      payload: {
        text: "Running the coding agent without a sandbox (X_FACTORY_ALLOW_UNSANDBOXED=1).",
        warning: "unsandboxed",
      },
      timestamp: new Date().toISOString(),
    };

    const { container } = render(
      React.createElement(ChatThread, { events: [unsandboxedEvent] }),
    );

    const bubble = container.querySelector(".chat-bubble.bubble-warning");
    expect(bubble).not.toBeNull();
    const badge = bubble?.querySelector(".chat-bubble-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("Warning");
    expect(bubble?.textContent).toContain("without a sandbox");
  });
});

describe("RunChat unsandboxed warning line (#275)", () => {
  const dummyRun: Run = {
    id: "run-1",
    project: { id: "proj-1", name: "Project 1" },
    ticket: {
      id: "T-1",
      title: "Test Ticket",
      description: "Test Description",
      acceptanceCriteria: [],
    },
    plan: "plan",
    branch: "feat/t-1",
    status: "executing",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/artifacts",
    worktreePath: "/tmp/worktree",
  };

  it("renders unsandboxed attempt info event as a warning system divider in RunChat", () => {
    const unsandboxedEvent: RunEvent = {
      id: 10,
      type: "info",
      payload: {
        text: "Running the coding agent without a sandbox (X_FACTORY_ALLOW_UNSANDBOXED=1).",
        warning: "unsandboxed",
      },
      timestamp: new Date().toISOString(),
    };

    const { container } = render(
      React.createElement(RunChat, {
        run: dummyRun,
        events: [unsandboxedEvent],
      }),
    );

    const warningPill = container.querySelector(".imsg-system-pill-warning");
    expect(warningPill).not.toBeNull();
    expect(warningPill?.textContent).toContain("without a sandbox");
  });
});
