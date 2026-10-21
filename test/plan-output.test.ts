// test/plan-output.test.ts — The Builder's plan as the run stores it: one Execution Plan heading,
// however many times the model writes it (the plan prompt's draft carries the heading too).

import { describe, expect, it } from "bun:test";
import { parsePlanOutput } from "../src/plan.js";

describe("parsePlanOutput keeps one # Execution Plan heading", () => {
  it("drops a second # Execution Plan heading the model repeats, keeping the first", () => {
    const output = `# Execution Plan for #T-1: Add the feature
# Execution Plan for #T-1: Add the feature

## Task 1: Add a failing test
- Add \`test/feature.test.ts\` covering the new behaviour.

## Task 2: Implement it
- Change \`src/feature.ts\`.
`;

    const plan = parsePlanOutput(output);

    const headings = plan
      .split("\n")
      .filter((line) => /^# Execution Plan\b/.test(line));
    expect(headings).toEqual(["# Execution Plan for #T-1: Add the feature"]);
    expect(plan).toContain("## Task 1: Add a failing test");
    expect(plan).toContain("- Change `src/feature.ts`.");
  });

  it("leaves a plan with a single heading unchanged", () => {
    const output = `# Execution Plan for #T-2: Ship it

## Task 1: Add a failing test
- Add \`test/ship.test.ts\`.

## Task 2: Implement
- Change \`src/ship.ts\`.
`;

    expect(parsePlanOutput(output)).toBe(output.trim());
  });
});
