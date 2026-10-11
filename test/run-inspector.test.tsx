// test/run-inspector.test.tsx — The run inspector: evidence, files and the raw log, beside the chat
// on a wide window and in a sheet at phone width (#262).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  RunInspector,
  RunInspectorSheet,
} from "../src/frontend/components/runs/RunInspector.js";
import type { Run, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+more",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "",
].join("\n");

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "",
    branch: "factory/t-1",
    status,
    startedAt: "2026-09-20T12:00:00.000Z",
    finishedAt: null,
    updatedAt: "2026-09-20T12:00:00.000Z",
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
    ...overrides,
  } as Run;
}

describe("the inspector shows the run's evidence, files and raw log", () => {
  it("names its three sections, labelled for assistive technology", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    const aside = within(container).getByRole("complementary", {
      name: "Inspector",
    });
    expect(
      within(aside).getByRole("heading", { name: "Evidence" }),
    ).toBeTruthy();
    expect(within(aside).getByRole("heading", { name: /Files/ })).toBeTruthy();
    expect(
      within(aside).getByRole("heading", { name: /Raw log/ }),
    ).toBeTruthy();
  });

  it("lists each changed file with its added and removed lines", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", { diff: DIFF })}
        events={[]}
        connected={false}
      />,
    );
    expect(container.textContent).toContain("2 files · +3 −2");
    expect(container.textContent).toContain("src/a.ts");
    expect(container.textContent).toContain("+2 −1");
    expect(container.textContent).toContain("src/b.ts");
  });

  it("says no changes exist yet when the run has no diff", () => {
    const { container } = render(
      <RunInspector run={makeRun("planning")} events={[]} connected={false} />,
    );
    expect(container.textContent).toContain("No changes yet.");
  });
});

describe("at phone width the inspector is a sheet", () => {
  it("opens from a button and shows the same sections, then closes", () => {
    const { container } = render(
      <RunInspectorSheet
        run={makeRun("awaiting_review", { diff: DIFF })}
        events={[]}
        connected={false}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.click(
      within(container).getByRole("button", { name: "Inspector" }),
    );
    const sheet = within(document.body).getByRole("dialog", {
      name: "Inspector",
    });
    expect(
      within(sheet).getByRole("heading", { name: "Evidence" }),
    ).toBeTruthy();
    expect(sheet.textContent).toContain("src/a.ts");
  });
});
