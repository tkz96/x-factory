// test/run-models-ui.test.tsx — The run page and runs list say which model did
// each stage, with tokens and cost when known (#279).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ChatThread } from "../src/frontend/components/runs/ChatThread.js";
import { TokenUsage } from "../src/frontend/components/runs/TokenUsage.js";
import { formatUsd } from "../src/frontend/lib/format-money.js";
import {
  formatTokenCount,
  latestModelFor,
  stageStartedText,
  usageFor,
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

  it("writes token counts compactly", () => {
    expect(formatTokenCount(900)).toBe("900");
    expect(formatTokenCount(12_400)).toBe("12.4K");
    expect(formatTokenCount(2_000)).toBe("2K");
    expect(formatTokenCount(3_250_000)).toBe("3.3M");
  });

  it("writes cost with two decimals, and more only below a cent", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.047)).toBe("$0.05");
    expect(formatUsd(0.0047)).toBe("$0.0047");
    expect(formatUsd(3.5)).toBe("$3.50");
  });

  it("adds a role's usage over every stage, and names the steps that reported none", () => {
    const plan = { ...BUILDER, stage: "plan", step: "plan", tokensIn: 600 };
    const code = {
      ...BUILDER,
      step: "execute",
      tokensIn: undefined,
      tokensOut: undefined,
      costUsd: undefined,
    };
    const usage = usageFor([BUILDER, plan, REVIEWER, code], "builder");
    expect(usage?.modelId).toBe("gemini-flash-lite-latest");
    expect(usage?.tokensIn).toBe(13_000);
    expect(usage?.tokensOut).toBe(4_200);
    expect(usage?.costUsd).toBeCloseTo(0.0124);
    expect(usage?.unreportedSteps).toEqual(["execute"]);
    expect(usageFor([BUILDER], "reviewer")).toBeUndefined();
    expect(usageFor([REVIEWER], "reviewer")?.tokensIn).toBeUndefined();
  });

  it("shows tokens in and out each with a glyph, and the unreported steps on hover", () => {
    const usage = usageFor(
      [
        BUILDER,
        {
          ...BUILDER,
          tokensIn: undefined,
          tokensOut: undefined,
          costUsd: undefined,
        },
      ],
      "builder",
    );
    if (!usage) throw new Error("no usage");
    const { container } = render(<TokenUsage usage={usage} />);
    expect(container.querySelector(".token-usage-in")?.textContent).toBe(
      "12.4K tokens in",
    );
    expect(container.querySelector(".token-usage-out")?.textContent).toBe(
      "2.1K tokens out",
    );
    expect(container.querySelector(".token-usage-cost")?.textContent).toBe(
      "$0.0062",
    );
    expect(container.querySelector(".token-usage")?.getAttribute("title")).toBe(
      "Not reported for Code",
    );
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
