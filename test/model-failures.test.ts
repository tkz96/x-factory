// test/model-failures.test.ts — How a failed model call is told: one timeline sentence,
// a failure reason that names the model and the fix, and no retry when the same call
// would only fail again. The stage-level behaviour is in model-provider-failures.test.ts;
// this file pins each category's copy and the provider-text reading.

import { describe, expect, it } from "bun:test";
import { classifyModelError } from "../src/agents/pi.js";
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageContext } from "../src/executors/types.js";
import {
  firstSentence,
  innermostProviderMessage,
  isModelNotFoundMessage,
  modelErrorSentence,
  modelNotFoundSentence,
  modelStageFailure,
  providerLabel,
  providerSentence,
} from "../src/model-failures.js";
import { RateLimitedError } from "../src/model-gateway.js";
import {
  ModelUnavailableError,
  type ResolvedModel,
} from "../src/model-roles.js";
import { formatApproxWait } from "../src/retry-delay.js";
import { chatFailureMessage } from "../src/runs.js";
import type { VerificationResult } from "../src/shared/types.js";
import { providerErrorText } from "./helpers/provider-error-fixture.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";

const NOT_FOUND = providerErrorText("gemini-404-event");
const QUOTA = providerErrorText("gemini-429-daily-quota-event");

function model(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
  return { ...testResolvedModel("builder"), ...overrides };
}

describe("reading a provider's error text", () => {
  it("follows nested error bodies down to the provider's own message", () => {
    expect(firstSentence(innermostProviderMessage(NOT_FOUND))).toBe(
      "This model models/gemini-2.5-flash is no longer available to new users.",
    );
    expect(firstSentence(innermostProviderMessage(QUOTA))).toBe(
      "You exceeded your current quota, please check your plan and billing details.",
    );
  });

  // The run that showed "Model not available: ck another model…": the loop built
  // the message from a 500-character TAIL of the process output, and the window
  // started mid-sentence inside the provider's message.
  it("keeps the provider's whole sentence when the error sits in the middle of a long output", () => {
    const json =
      '{"error":{"code":404,"message":"Model xyz is not available. Please pick another model."}}';
    const output =
      `noise line\n`.repeat(120) +
      json +
      `\ntrailing cleanup ${"x ".repeat(80)}`;

    // The tail window alone cuts the sentence in half — that was the bug.
    expect(providerSentence(output.trim().slice(-500))).not.toBe(
      "Model xyz is not available.",
    );
    expect(modelNotFoundSentence(output)).toBe("Model xyz is not available.");
  });

  it("reads the sentence out of a nested JSON error body anywhere in the output", () => {
    const nested =
      '{"error":{"message":"{\\"error\\":{\\"code\\":404,\\"message\\":\\"Model xyz is not available. Please pick another model.\\"}}"}}';
    expect(modelNotFoundSentence(`before\n${nested}\nafter`)).toBe(
      "Model xyz is not available.",
    );
  });

  it("falls back to the tail of the output when no line names a missing model", () => {
    expect(modelNotFoundSentence(`nothing to see\n${"y".repeat(600)}`)).toBe(
      `${"y".repeat(199)}…`,
    );
  });

  it("returns text that is not JSON as it is, and caps a long sentence", () => {
    expect(innermostProviderMessage("  plain failure ")).toBe("plain failure");
    expect(innermostProviderMessage('{"error":"flat"}')).toBe("flat");
    expect(innermostProviderMessage('{"message":"top"}')).toBe("top");
    expect(innermostProviderMessage("{not json")).toBe("{not json");
    expect(firstSentence("a".repeat(300), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("recognises a model the provider does not offer, and nothing else", () => {
    expect(isModelNotFoundMessage(NOT_FOUND)).toBe(true);
    expect(
      isModelNotFoundMessage(
        '{"error":{"type":"not_found_error","message":"model: claude-x"}}',
      ),
    ).toBe(true);
    expect(
      isModelNotFoundMessage(
        "The model `gpt-9` does not exist or you do not have access to it.",
      ),
    ).toBe(true);
    expect(isModelNotFoundMessage(QUOTA)).toBe(false);
    expect(isModelNotFoundMessage("bash: pi: command not found")).toBe(false);
    expect(isModelNotFoundMessage("401 Unauthorized")).toBe(false);
  });

  it("classifies the Gemini 404 as a model that is not available", () => {
    const err = classifyModelError(NOT_FOUND);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as ModelUnavailableError).category).toBe("model not found");
    expect((err as ModelUnavailableError).raw).toBe(NOT_FOUND);
    expect(classifyModelError(QUOTA)).toBeInstanceOf(RateLimitedError);
  });

  it("says a wait the way a person would", () => {
    expect(formatApproxWait(82_837_000)).toBe("about 23 h");
    expect(formatApproxWait(15 * 60_000)).toBe("about 15 min");
    expect(formatApproxWait(40_000)).toBe("about 40 s");
  });
});

describe("the timeline sentence", () => {
  it("names the provider by its API type, or by the connection's name", () => {
    expect(providerLabel(model({ apiType: "gemini" }))).toBe("Gemini");
    expect(providerLabel(model({ apiType: "anthropic" }))).toBe("Anthropic");
    expect(providerLabel(model())).toBe('"Test connection"');
  });

  it("is one short sentence per category, never the raw body", () => {
    const gemini = model({ apiType: "gemini", modelId: "gemini-x" });
    expect(
      modelErrorSentence(
        new ModelUnavailableError("Rate limited: …", "rate limited"),
        gemini,
      ),
    ).toBe("Gemini kept rate limiting gemini-x, so the call was stopped.");
    expect(
      modelErrorSentence(
        new ModelUnavailableError("Key rejected: 401 {…}", "key rejected"),
        gemini,
      ),
    ).toBe('Gemini rejected the API key of "Test connection".');
    expect(
      modelErrorSentence(
        new ModelUnavailableError("Context too large: …", "context too large"),
        gemini,
      ),
    ).toBe("Context too large: …");
    expect(modelErrorSentence(new Error(NOT_FOUND), gemini)).toBe(
      "Gemini returned an error for gemini-x: This model models/gemini-2.5-flash is no longer available to new users.",
    );
    expect(modelErrorSentence("boom", gemini)).toBe(
      "Gemini returned an error for gemini-x: boom",
    );
  });
});

describe("the stage failure", () => {
  it("does not retry a rejected key, and says to check the key", () => {
    const outcome = modelStageFailure(
      new ModelUnavailableError("Key rejected: 401", "key rejected", {
        raw: "401 {body}",
      }),
      model({ apiType: "anthropic" }),
    );
    expect(outcome.retryable).toBe(false);
    expect(outcome.error).toBe(
      "Key rejected: 401 Provider response: 401 {body}",
    );
    expect(outcome.failure).toEqual({
      category: "model",
      message: 'Anthropic rejected the API key of "Test connection".',
      recovery: "Check the key in Settings › Models, then start a new run.",
    });
  });

  it("does not retry a prompt too large for the window, and names the fix for the role", () => {
    const outcome = modelStageFailure(
      new ModelUnavailableError("Context too large: x", "context too large"),
      model({ role: "reviewer" }),
    );
    expect(outcome.retryable).toBe(false);
    expect(outcome.failure?.recovery).toBe(
      "Choose a model with a larger context window for the Reviewer in Settings › Models, then start a new run.",
    );
  });

  it("says a quota is used up even when the provider gave no reset time", () => {
    const outcome = modelStageFailure(
      new ModelUnavailableError("Quota used up", "quota exhausted"),
      model({ modelId: "m" }),
    );
    expect(outcome.failure?.message).toBe(
      "The provider's quota for m is used up.",
    );
  });

  it("keeps a retry, and leaves the reason to the runner, for a model that may come back", () => {
    const outcome = modelStageFailure(
      new ModelUnavailableError("Builder has no model."),
      undefined,
    );
    expect(outcome).toEqual({
      outcome: "error",
      error: "Model unavailable: Builder has no model.",
    });
  });
});

describe("chat says what happened to the model", () => {
  it("names a model that is not available and a used-up quota", () => {
    expect(
      chatFailureMessage(new ModelUnavailableError("gone", "model not found")),
    ).toBe(
      "The Builder's model isn't available from its provider. Choose another model in Settings › Models.",
    );
    expect(
      chatFailureMessage(
        new ModelUnavailableError("quota", "quota exhausted", {
          retryAfterMs: 82_837_000,
        }),
      ),
    ).toBe(
      "The model's provider quota is used up; it resets in about 23 h. Choose another model in Settings › Models, or wait.",
    );
    expect(
      chatFailureMessage(new ModelUnavailableError("quota", "quota exhausted")),
    ).toBe(
      "The model's provider quota is used up. Choose another model in Settings › Models, or wait for it to reset.",
    );
  });
});

describe("the review stage", () => {
  const VERIFICATION: VerificationResult = {
    passed: true,
    repairAttempt: 1,
    tests: {
      command: "bun test",
      passed: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
    diff: "diff",
    filesChanged: ["a"],
    hasPollution: false,
    summary: "ok",
  };

  it("fails without a retry for a Reviewer model the provider no longer offers, with one sentence on the timeline", async () => {
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const reviewer = model({
      role: "reviewer",
      apiType: "gemini",
      modelId: "gemini-2.5-flash",
    });
    const executor = new ReviewExecutor({
      resolveRole: async () => reviewer,
      sessionFactory: async () =>
        scriptedReviewSession("", {
          promptError: new Error(NOT_FOUND),
          emitErrorEvent: true,
        }),
    });
    const context = {
      run: {
        id: "run-review-404",
        ticket: { id: "T", title: "T", acceptanceCriteria: [] },
        plan: "1. Do it",
        diff: "diff",
        verification: VERIFICATION,
        artifactsDir: "/tmp",
        worktreePath: "/tmp",
        implementationContext: null,
      },
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
      recordModel: () => {},
      reportUsage: () => {},
      signal: undefined,
    } as unknown as StageContext;

    const outcome = await executor.execute(context);

    expect(outcome.outcome).toBe("error");
    if (outcome.outcome !== "error") return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.failure?.recovery).toBe(
      "Choose another model for the Reviewer in Settings › Models, then start a new run.",
    );
    expect(emitted.filter((e) => e.type === "error")).toEqual([
      {
        type: "error",
        payload: {
          message:
            "Gemini says gemini-2.5-flash isn't available: This model models/gemini-2.5-flash is no longer available to new users.",
        },
      },
    ]);
  });
});
