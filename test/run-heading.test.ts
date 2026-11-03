import { describe, expect, it } from "bun:test";
import {
  runHeadingSubtitle,
  runHeadingTitle,
} from "../src/frontend/lib/run-heading.js";
import type { Run } from "../src/shared/types.js";

function run(over: Record<string, unknown>): Run {
  return {
    id: "run-1",
    branch: "factory/t-1",
    project: { id: "p", name: "Proj" },
    ticket: { id: "GH-3", title: "Fix it" },
    ...over,
  } as unknown as Run;
}

describe("the run heading", () => {
  it("names a run by ticket id and title", () => {
    expect(runHeadingTitle(run({}))).toBe("GH-3 — Fix it");
  });

  it("invents no title when the ticket has none", () => {
    expect(runHeadingTitle(run({ ticket: { id: "GH-3", title: "" } }))).toBe(
      "GH-3",
    );
    expect(runHeadingTitle(run({ ticket: undefined }))).toBe("run-1");
  });

  it("joins project and branch, and never prints undefined", () => {
    expect(runHeadingSubtitle(run({}))).toBe("Proj · factory/t-1");
    expect(runHeadingSubtitle(run({ project: undefined }))).toBe("factory/t-1");
    expect(runHeadingSubtitle(run({ branch: undefined }))).toBe("Proj");
  });
});
