// test/run-models-ui.test.tsx — The run page and runs list say which model did
// each stage, with tokens and cost when known (#279).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { RunModelsCard } from "../src/frontend/components/runs/RunModelsCard.js";
import {
  formatUsage,
  latestModelFor,
  stageStartedText,
} from "../src/frontend/lib/run-models.js";
import type { RunEvent, StageModelUse } from "../src/shared/types.js";

const BUILDER: StageModelUse = {
  role: "builder",
  connectionId: "c1",
  connectionName: "Gemini",
  apiType: "gemini",
  modelId: "gemini-flash-lite-latest",
  stage: "execute",
  attempt: 1,
  startedAt: "2026-10-11T10:00:00.000Z",
  tokensIn: 12_400,
  tokensOut: 2_100,
  costUsd: 0.0062,
};

const REVIEWER: StageModelUse = {
  ...BUILDER,
  role: "reviewer",
  modelId: "gemini-pro",
  stage: "review",
  startedAt: "2026-10-11T10:05:00.000Z",
  tokensIn: undefined,
  tokensOut: undefined,
  costUsd: undefined,
};

afterEach(() => cleanup());
afterAll(async () => {
  await unregisterHappyDom();
});

describe("run model helpers (#279)", () => {
  it("finds each role's latest model", () => {
    const retry = { ...BUILDER, attempt: 2, modelId: "gemini-x" };
    expect(latestModelFor([BUILDER, REVIEWER, retry], "builder")?.modelId).toBe(
      "gemini-x",
    );
    expect(latestModelFor([BUILDER], "reviewer")).toBeUndefined();
  });

  it("formats usage compactly, and says nothing when nothing was reported", () => {
    expect(formatUsage(BUILDER)).toBe("12.4K in · 2.1K out · $0.0062");
    expect(formatUsage(REVIEWER)).toBe("");
    expect(formatUsage({ ...REVIEWER, tokensIn: 900 })).toBe("900 in");
  });

  it("describes a stage start in words", () => {
    expect(
      stageStartedText({ stage: "execute", attempt: 1, model: BUILDER }),
    ).toBe("Coding with gemini-flash-lite-latest via Gemini");
    expect(
      stageStartedText({ stage: "review", attempt: 1, model: REVIEWER }),
    ).toBe("Reviewing with gemini-pro via Gemini");
  });
});

describe("RunModelsCard (#279)", () => {
  it("shows each role's model in its header and every attempt with usage", () => {
    const { container } = render(
      <RunModelsCard stageModels={[BUILDER, REVIEWER]} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Builder");
    expect(text).toContain("gemini-flash-lite-latest");
    expect(text).toContain("Reviewer");
    expect(text).toContain("gemini-pro");
    expect(text).toContain("12.4K in · 2.1K out · $0.0062");
    expect(container.querySelectorAll(".run-models-row")).toHaveLength(2);
  });

  it("renders nothing before any stage has used a model", () => {
    const { container } = render(<RunModelsCard stageModels={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("ChatThread stage_started (#279)", () => {
  it("shows a stage start as a system line naming the model", () => {
    const event: RunEvent = {
      id: 3,
      type: "stage_started",
      payload: { stage: "execute", attempt: 1, model: BUILDER },
      timestamp: "2026-10-11T10:00:00.000Z",
    };
    const { container } = render(<ChatThread events={[event]} />);
    expect(container.textContent).toContain(
      "Coding with gemini-flash-lite-latest via Gemini",
    );
  });
});
