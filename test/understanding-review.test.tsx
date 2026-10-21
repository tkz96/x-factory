// test/understanding-review.test.tsx — The understanding checkpoint shows what the understand stage
// produced: the decisions the operator must make first, then the risks, then the rest of the
// understanding. A run understood before these fields existed shows only what it has.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { UnderstandingReview } from "../src/frontend/components/runs/UnderstandingReview.js";
import type { ImplementationContext } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const CONFLICT =
  'Criterion "negate(3) returns 3" contradicts "negate(-3) returns 3".';

function makeContext(
  overrides: Partial<ImplementationContext> = {},
): ImplementationContext {
  return {
    relevantFiles: ["src/math.ts"],
    architecturalNotes: "Pure functions live in src/math.ts.",
    existingBehavior: "negate(x) returns -x.",
    constraints: ['Test command must pass: "bun test"'],
    risks: ["Changing negate breaks its callers."],
    conflicts: [],
    ...overrides,
  };
}

describe("the understanding checkpoint shows the whole understanding", () => {
  it("shows the relevant files, the existing behaviour, the constraints and the architectural notes", () => {
    const { container, getByText } = render(
      <UnderstandingReview context={makeContext()} />,
    );

    expect(getByText("src/math.ts")).toBeTruthy();
    expect(getByText("negate(x) returns -x.")).toBeTruthy();
    expect(getByText('Test command must pass: "bun test"')).toBeTruthy();
    expect(container.textContent).toContain(
      "Pure functions live in src/math.ts.",
    );
  });

  it("shows the risks", () => {
    const { getByText } = render(
      <UnderstandingReview context={makeContext()} />,
    );

    expect(getByText("Changing negate breaks its callers.")).toBeTruthy();
  });

  it("puts the decisions first, then the risks, then the rest of the understanding", () => {
    const { container } = render(
      <UnderstandingReview context={makeContext({ conflicts: [CONFLICT] })} />,
    );
    const text = container.textContent ?? "";

    const decision = text.indexOf("Needs your decision");
    const risk = text.indexOf("Changing negate breaks its callers.");
    const behaviour = text.indexOf("negate(x) returns -x.");
    expect(decision).toBeGreaterThanOrEqual(0);
    expect(decision).toBeLessThan(risk);
    expect(risk).toBeLessThan(behaviour);
  });
});

describe("the understanding checkpoint shows the conflicts and the change verdict", () => {
  it("puts a 'Needs your decision' list with each conflict on the checkpoint", () => {
    const { container, getByText } = render(
      <UnderstandingReview context={makeContext({ conflicts: [CONFLICT] })} />,
    );

    expect(getByText("Needs your decision")).toBeTruthy();
    expect(container.textContent).toContain(CONFLICT);
  });

  it("says plainly that no change is required, with the reason", () => {
    const { getByText } = render(
      <UnderstandingReview
        context={makeContext({
          changeRequired: false,
          changeReason: "sum already exists in src/math.ts.",
        })}
      />,
    );

    expect(
      getByText("The understanding found that no change is required"),
    ).toBeTruthy();
    expect(getByText("sum already exists in src/math.ts.")).toBeTruthy();
  });

  it("says nothing about a change when one is required", () => {
    const { queryByText } = render(
      <UnderstandingReview context={makeContext({ changeRequired: true })} />,
    );

    expect(queryByText(/no change is required/)).toBeNull();
  });

  it("shows no decision heading when the criteria agree", () => {
    const { queryByText } = render(
      <UnderstandingReview context={makeContext({ conflicts: [] })} />,
    );

    expect(queryByText("Needs your decision")).toBeNull();
  });

  it("shows no decision heading or verdict for a run understood before these fields existed", () => {
    const legacy = makeContext();
    delete legacy.conflicts;
    delete legacy.changeRequired;
    const { queryByText, getByText } = render(
      <UnderstandingReview context={legacy} />,
    );

    expect(queryByText("Needs your decision")).toBeNull();
    expect(queryByText(/no change is required/)).toBeNull();
    expect(getByText("src/math.ts")).toBeTruthy();
  });
});
