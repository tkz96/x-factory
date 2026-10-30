// test/run-inspector.test.tsx — The "Run details" pane: its run, models, files and evidence sections,
// the raw log opened from its footer, and the same pane in a sheet at phone width (#262, spec #241).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import {
  RunInspector,
  RunInspectorSheet,
} from "../src/frontend/components/runs/RunInspector.js";
import type { Run, RunStatus, StageModelUse } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
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

const BUILDER_USE = {
  stage: "execute",
  step: "execute",
  role: "builder",
  attempt: 1,
  connectionId: "c-1",
  connectionName: "Gemini",
  apiType: "gemini",
  modelId: "gemini-x",
  startedAt: "2026-09-20T12:00:00.000Z",
} as Run["stageModels"] extends (infer U)[] | undefined ? U : never;

describe("the Run details pane names its sections", () => {
  it("is labelled Run details and holds its sections that have content", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    const pane = within(container).getByRole("complementary", {
      name: "Run details",
    });
    expect(
      within(pane).getByRole("heading", { level: 2, name: "Run details" }),
    ).toBeTruthy();
    // Models and Files have nothing to show yet, so they are not drawn (spec #312).
    for (const name of ["Run", "Ticket", "Evidence"]) {
      expect(
        within(pane).getByRole("heading", { level: 3, name: new RegExp(name) }),
      ).toBeTruthy();
    }
  });

  it("shows the run's branch in mono on the right and the pull request as None yet", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    // The branch row copies the branch, so its value sits in the row's copy control.
    const branch = within(container).getByText("factory/t-1").closest("dd");
    expect(branch?.classList.contains("run-inspector-value")).toBe(true);
    expect(within(container).getAllByText("None yet").length).toBeGreaterThan(
      0,
    );
  });

  it("links the pull request when the run has one", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          pullRequest: {
            url: "https://example.test/acme/repo/pull/42",
            branch: "factory/t-1",
            baseBranch: "main",
            title: "T-1",
          },
        })}
        events={[]}
        connected={false}
      />,
    );
    const link = within(container).getByRole("link", { name: "#42" });
    expect(link.getAttribute("href")).toBe(
      "https://example.test/acme/repo/pull/42",
    );
  });

  it("shows the model of a role that ran, and leaves out a role that has not run", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", { stageModels: [BUILDER_USE] })}
        events={[]}
        connected={false}
      />,
    );
    expect(within(container).getByText("gemini-x")).toBeTruthy();
    expect(container.textContent).toContain("Builder");
    expect(container.textContent).not.toContain("Reviewer");
  });
});

describe("the Ticket section shows the ticket as the run received it", () => {
  it("shows the description with its line breaks and each acceptance criterion", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("executing", {
          ticket: {
            id: "T-1",
            title: "A ticket",
            description: "First line.\nSecond line.",
            acceptanceCriteria: ["It loads", "It stays put"],
          },
        })}
        events={[]}
        connected={false}
      />,
    );
    const description = container.querySelector(".run-ticket-description");
    expect(description?.textContent).toBe("First line.\nSecond line.");
    const criteria = within(container).getByRole("list", {
      name: "Acceptance criteria",
    });
    expect(
      within(criteria)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["It loads", "It stays put"]);
    expect(within(container).queryByRole("status")).toBeNull();
  });

  it("warns when the run has only the ticket's title", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    expect(within(container).getByRole("status").textContent).toContain(
      "only the ticket's title",
    );
  });
});

describe("the Files section lists each changed file as a button", () => {
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
    const row = within(container).getByRole("button", { name: /src\/a\.ts/ });
    expect(row.tagName).toBe("BUTTON");
  });

  it("leaves the Files section out when the run has no diff", () => {
    const { container } = render(
      <RunInspector run={makeRun("planning")} events={[]} connected={false} />,
    );
    expect(
      within(container).queryByRole("heading", { name: "Files" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("No changes yet.");
  });

  it("opens the diff for a file when its row is pressed", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", { diff: DIFF })}
        events={[]}
        connected={false}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: /src\/b\.ts/ }),
    );
    const dialog = within(document.body).getByRole("dialog", {
      name: "Diff for src/b.ts",
    });
    expect(dialog.textContent).toContain("+y");
  });
});

describe("the Evidence section shows each check's verdict", () => {
  it("marks passing checks Pass and failing ones Fail, in green and red", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          verification: {
            passed: true,
            tests: { skipped: false },
          } as Run["verification"],
          review: {
            passed: false,
            summary: "",
            criteriaChecked: [
              { criterion: "Must verify", status: "pass" },
              { criterion: "Must review", status: "fail" },
              { criterion: "Must deploy", status: "not_assessed" },
            ],
          } as unknown as Run["review"],
        })}
        events={[]}
        connected={false}
      />,
    );
    expect(within(container).getByText("Must verify")).toBeTruthy();
    const fail = within(container).getAllByText("Fail")[0];
    expect(fail?.classList.contains("run-inspector-value--fail")).toBe(true);
    const pass = within(container).getAllByText("Pass")[0];
    expect(pass?.classList.contains("run-inspector-value--pass")).toBe(true);
  });

  // A review stored before status existed carries satisfied: boolean; it reads as its verdict.
  it("reads a review stored before status existed by its satisfied flag", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          review: {
            passed: false,
            summary: "Review failed: 1 unmet criteria.",
            criteriaChecked: [
              { criterion: "Must verify", satisfied: true },
              { criterion: "Must review", satisfied: false },
            ],
          } as unknown as Run["review"],
        })}
        events={[]}
        connected={false}
      />,
    );
    expect(within(container).getByText("Must verify")).toBeTruthy();
    expect(within(container).queryByText("Not assessed")).toBeNull();
    const fail = within(container).getAllByText("Fail")[0];
    expect(fail?.classList.contains("run-inspector-value--fail")).toBe(true);
    const pass = within(container).getAllByText("Pass")[0];
    expect(pass?.classList.contains("run-inspector-value--pass")).toBe(true);
  });

  // A criterion the Reviewer never assessed must read as such — never as a pass.
  it("shows a criterion the reviewer did not assess as Not assessed, muted", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          review: {
            passed: false,
            summary:
              "Review failed: 0 blocking errors, 0 unmet criteria, 1 not assessed.",
            criteriaChecked: [
              { criterion: "Must verify", status: "pass" },
              { criterion: "Must deploy", status: "not_assessed" },
            ],
          } as unknown as Run["review"],
        })}
        events={[]}
        connected={false}
      />,
    );
    const notAssessed = within(container).getByText("Not assessed");
    expect(notAssessed?.classList.contains("run-inspector-value--muted")).toBe(
      true,
    );
    expect(notAssessed?.classList.contains("run-inspector-value--pass")).toBe(
      false,
    );
  });
});

describe("the raw log opens from the footer", () => {
  it("names the event count on the Raw log button and opens the log in a sheet", () => {
    const events = [
      {
        id: 1,
        type: "status",
        timestamp: "2026-09-20T12:00:00.000Z",
        payload: { status: "planning" },
      },
      {
        id: 2,
        type: "status",
        timestamp: "2026-09-20T12:00:01.000Z",
        payload: { status: "planning" },
      },
    ] as never;
    const { container } = render(
      <RunInspector
        run={makeRun("planning")}
        events={events}
        connected={false}
      />,
    );
    const button = within(container).getByRole("button", { name: /Raw Log/ });
    expect(button.textContent).toContain("2 events");
    expect(container.querySelector(".run-inspector-live-dot")).toBeNull();
    fireEvent.click(button);
    expect(
      within(document.body).getByRole("dialog", { name: "Raw log" }),
    ).toBeTruthy();
  });

  it("says one event in the singular", () => {
    const events = [
      {
        id: 1,
        type: "status",
        timestamp: "2026-09-20T12:00:00.000Z",
        payload: { status: "planning" },
      },
    ] as never;
    const { container } = render(
      <RunInspector run={makeRun("planning")} events={events} connected />,
    );
    const button = within(container).getByRole("button", { name: /Raw Log/ });
    expect(button.textContent).toContain("1 event");
    expect(button.textContent).not.toContain("1 events");
    expect(container.querySelector(".run-inspector-live-dot")).not.toBeNull();
  });
});

describe("at phone width the same pane is a sheet", () => {
  it("opens from a Details button and shows the same sections, then closes", () => {
    const { container } = render(
      <RunInspectorSheet
        run={makeRun("awaiting_review", { diff: DIFF })}
        events={[]}
        connected={false}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(
      within(container).queryByRole("button", { name: "Inspector" }),
    ).toBeNull();
    const trigger = within(container).getByRole("button", { name: "Details" });
    expect(trigger.textContent?.trim()).toBe("Details");
    fireEvent.click(trigger);
    const sheet = within(document.body).getByRole("dialog", {
      name: "Run details",
    });
    expect(
      within(sheet).getByRole("heading", { level: 3, name: "Evidence" }),
    ).toBeTruthy();
    expect(sheet.textContent).toContain("src/a.ts");
    expect(within(sheet).getByRole("button", { name: /Raw Log/ })).toBeTruthy();
  });
});

describe("the Models section names each role's latest model with its usage (#279)", () => {
  const builder = {
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
  } as unknown as StageModelUse;
  const reviewer = {
    ...builder,
    role: "reviewer",
    modelId: "gemini-pro",
    stage: "review",
    step: "review",
    tokensIn: undefined,
    tokensOut: undefined,
    costUsd: undefined,
  } as unknown as StageModelUse;

  it("shows the model with its tokens and cost, and only the model when nothing was reported", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("executing", { stageModels: [builder, reviewer] })}
        events={[]}
        connected={false}
      />,
    );
    const pane = within(container).getByRole("complementary", {
      name: "Run details",
    });
    const builderRow = within(pane).getByText(
      "gemini-flash-lite-latest",
    ).parentElement;
    expect(builderRow?.textContent).toBe(
      "gemini-flash-lite-latest12.4K tokens in2.1K tokens out$0.0062",
    );
    expect(within(pane).getByText("gemini-pro")).toBeTruthy();
  });
});

describe("the value kinds keep long rows from pushing a verdict out of the pane", () => {
  it("gives status words, model names and the branch their own truncation rule", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("awaiting_review", {
          stageModels: [BUILDER_USE],
          verification: {
            passed: true,
            tests: { skipped: false },
          } as unknown as Run["verification"],
        })}
        events={[]}
        connected={false}
      />,
    );
    const verdict = within(container).getByText("Pass");
    expect(verdict.classList.contains("run-inspector-value--status")).toBe(
      true,
    );
    const model = within(container).getByText("gemini-x");
    expect(
      model.closest("dd")?.classList.contains("run-inspector-value--wrap"),
    ).toBe(true);
    const branch = within(container).getByText("factory/t-1").closest("dd");
    expect(branch?.classList.contains("run-inspector-value--status")).toBe(
      false,
    );
    expect(branch?.classList.contains("run-inspector-value--wrap")).toBe(false);
    expect(branch?.getAttribute("title")).toBe("factory/t-1");
  });
});

describe("Run details rows: a fill only where a row does something (run page plan, 2b)", () => {
  function rowOf(container: HTMLElement, label: string) {
    return within(container).getByText(label, { selector: "dt" }).parentElement;
  }

  it("makes Branch, Ticket and Pull request whole-row actions, and leaves Started plain", () => {
    const { container } = render(
      <RunInspector
        run={makeRun("pr_created", {
          ticket: {
            id: "GH-7",
            title: "Factorial",
            url: "https://github.com/o/r/issues/7",
            acceptanceCriteria: [],
          },
          pullRequest: {
            url: "https://github.com/o/r/pull/9",
            branch: "factory/t-1",
            baseBranch: "main",
            title: "Factorial",
          },
        })}
        events={[]}
        connected={false}
      />,
    );
    for (const label of ["Branch", "Ticket", "Pull request"]) {
      expect(rowOf(container, label)?.classList.contains("ui-row-hover")).toBe(
        true,
      );
    }
    expect(
      rowOf(container, "Started")?.classList.contains("ui-row-hover"),
    ).toBe(false);
    const ticket = within(container).getByRole("link", { name: "GH-7" });
    expect(ticket.getAttribute("href")).toBe("https://github.com/o/r/issues/7");
    expect(ticket.classList.contains("run-inspector-stretch")).toBe(true);
    expect(within(container).getByRole("link", { name: "#9" })).toBeTruthy();
  });

  it("copies the branch when its row is pressed", async () => {
    let written = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written = text;
          return Promise.resolve();
        },
      },
    });
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: "Copy Branch" }),
      );
    });
    expect(written).toBe("factory/t-1");
    expect(
      within(container).getByRole("button", { name: "Branch copied" }),
    ).toBeTruthy();
  });

  it("has no fill on a row without an action", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    expect(rowOf(container, "Ticket")?.classList.contains("ui-row-hover")).toBe(
      false,
    );
  });
});

describe("the Evidence section of a finished run", () => {
  it("says Not run, not Awaiting, for a check a finished run never reached", () => {
    for (const status of ["failed", "stopped"] as const) {
      const { container, unmount } = render(
        <RunInspector run={makeRun(status)} events={[]} connected={false} />,
      );
      expect(within(container).getAllByText("Not run").length).toBe(2);
      expect(within(container).queryByText("Awaiting")).toBeNull();
      unmount();
    }
  });

  it("still says Awaiting on a run that has not got there yet", () => {
    const { container } = render(
      <RunInspector run={makeRun("executing")} events={[]} connected={false} />,
    );
    expect(within(container).getAllByText("Awaiting").length).toBe(2);
  });
});
