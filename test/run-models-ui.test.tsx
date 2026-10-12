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
  step: "execute",
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
  step: "review",
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

  it("writes cost with two decimals, and more only below a cent", () => {
    expect(formatUsage({ ...REVIEWER, costUsd: 0 })).toBe("$0.00");
    expect(formatUsage({ ...REVIEWER, costUsd: 0.047 })).toBe("$0.05");
    expect(formatUsage({ ...REVIEWER, costUsd: 0.0047 })).toBe("$0.0047");
    expect(formatUsage({ ...REVIEWER, costUsd: 3.5 })).toBe("$3.50");
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
  it("lists every attempt with its model and usage, and repeats nothing", () => {
    const { container } = render(
      <RunModelsCard stageModels={[BUILDER, REVIEWER]} />,
    );
    // A disclosure (F2): the card is foldable, and open on a first look.
    const details = container.querySelector("details.run-models");
    expect(details?.hasAttribute("open")).toBe(true);
    expect(container.querySelector("summary")?.textContent).toBe("Models");
    expect(container.querySelectorAll(".run-models-row")).toHaveLength(2);
    const text = container.textContent ?? "";
    expect(text).toContain("gemini-flash-lite-latest");
    expect(text).toContain("gemini-pro");
    expect(text).toContain("12.4K in · 2.1K out · $0.0062");
    // F7: the rows say it once, so nothing repeats them above.
    expect(container.querySelector(".run-models-summary")).toBeNull();
  });

  it("shows coding on the Builder and its review on the Reviewer when both ran in the execute stage", () => {
    const review: StageModelUse = {
      ...REVIEWER,
      stage: "execute",
      step: "review",
      tokensIn: 900,
    };
    const { container } = render(
      <RunModelsCard stageModels={[BUILDER, review]} />,
    );
    const rows = [...container.querySelectorAll(".run-models-row")].map(
      (row) => row.textContent ?? "",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Coding");
    expect(rows[0]).toContain("gemini-flash-lite-latest");
    expect(rows[0]).toContain("12.4K in · 2.1K out · $0.0062");
    expect(rows[1]).toContain("Reviewing");
    expect(rows[1]).toContain("gemini-pro");
    expect(rows[1]).toContain("900 in");
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

  it("names the review step, not the stage, when the execute stage starts its review", () => {
    expect(
      stageStartedText({
        stage: "execute",
        step: "review",
        attempt: 1,
        model: REVIEWER,
      }),
    ).toBe("Reviewing with gemini-pro via Gemini");
  });
});
