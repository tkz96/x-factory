// test/understanding-review.test.tsx — The understanding checkpoint shows what the understand stage
// produced: the decisions the operator must make first, then the risks, then the rest of the
// understanding. A run understood before these fields existed shows only what it has.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { UnderstandingReview } from "../src/frontend/components/runs/UnderstandingReview.js";
import type { ImplementationContext, Ticket } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const CONFLICT =
  'Criterion "negate(3) returns 3" contradicts "negate(-3) returns 3".';

const TICKET: Ticket = {
  id: "T-1",
  title: "Negate a number",
  description: "Add negate to the calculator.",
  acceptanceCriteria: ["negate(3) returns -3"],
};

const TITLE_ONLY: Ticket = {
  id: "T-2",
  title: "Run page 1: loading state",
  description: "",
  acceptanceCriteria: [],
};

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
      <UnderstandingReview ticket={TICKET} context={makeContext()} />,
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
      <UnderstandingReview ticket={TICKET} context={makeContext()} />,
    );

    expect(getByText("Changing negate breaks its callers.")).toBeTruthy();
  });

  it("puts the decisions first, then the risks, then the rest of the understanding", () => {
    const { container } = render(
      <UnderstandingReview
        ticket={TICKET}
        context={makeContext({ conflicts: [CONFLICT] })}
      />,
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
      <UnderstandingReview
        ticket={TICKET}
        context={makeContext({ conflicts: [CONFLICT] })}
      />,
    );

    expect(getByText("Needs your decision")).toBeTruthy();
    expect(container.textContent).toContain(CONFLICT);
  });

  it("says plainly that no change is required, with the reason", () => {
    const { getByText } = render(
      <UnderstandingReview
        ticket={TICKET}
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
      <UnderstandingReview
        ticket={TICKET}
        context={makeContext({ changeRequired: true })}
      />,
    );

    expect(queryByText(/no change is required/)).toBeNull();
  });

  it("shows no decision heading when the criteria agree", () => {
    const { queryByText } = render(
      <UnderstandingReview
        ticket={TICKET}
        context={makeContext({ conflicts: [] })}
      />,
    );

    expect(queryByText("Needs your decision")).toBeNull();
  });

  it("shows no decision heading or verdict for a run understood before these fields existed", () => {
    const legacy = makeContext();
    delete legacy.conflicts;
    delete legacy.changeRequired;
    const { queryByText, getByText } = render(
      <UnderstandingReview ticket={TICKET} context={legacy} />,
    );

    expect(queryByText("Needs your decision")).toBeNull();
    expect(queryByText(/no change is required/)).toBeNull();
    expect(getByText("src/math.ts")).toBeTruthy();
  });
});

describe("the understanding checkpoint shows the ticket it was drawn from", () => {
  it("shows the ticket's description and acceptance criteria after the understanding", () => {
    const { container, getByText } = render(
      <UnderstandingReview ticket={TICKET} context={makeContext()} />,
    );
    const text = container.textContent ?? "";

    expect(getByText("The ticket it read")).toBeTruthy();
    expect(getByText("Add negate to the calculator.")).toBeTruthy();
    expect(getByText("negate(3) returns -3")).toBeTruthy();
    expect(text.indexOf("negate(x) returns -x.")).toBeLessThan(
      text.indexOf("Add negate to the calculator."),
    );
  });

  it("warns first when the run has only the ticket's title", () => {
    const { container, getByRole, queryByText } = render(
      <UnderstandingReview ticket={TITLE_ONLY} context={makeContext()} />,
    );
    const warning = getByRole("status");
    const text = container.textContent ?? "";

    expect(warning.textContent).toContain("only the ticket's title");
    expect(text.indexOf("only the ticket's title")).toBeLessThan(
      text.indexOf("Changing negate breaks its callers."),
    );
    expect(queryByText("The ticket it read")).toBeNull();
  });

  it("does not warn when the ticket has a description or criteria", () => {
    const { queryByRole } = render(
      <UnderstandingReview
        ticket={{ ...TITLE_ONLY, acceptanceCriteria: ["It loads"] }}
        context={makeContext()}
      />,
    );

    expect(queryByRole("status")).toBeNull();
  });
});
