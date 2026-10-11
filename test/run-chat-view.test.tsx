// test/run-chat-view.test.tsx — The run chat as a user meets it (#261): real events in order,
// quiet status lines, grouped progress, a scroll position that is kept, and actions from the map.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { formatTimestamp } from "../src/frontend/lib/format-timestamp.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-09-20T12:34:56.000Z";

function makeRun(status: RunStatus, overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: {
      id: "T-1",
      title: "A ticket",
      url: "https://t",
      acceptanceCriteria: [],
    },
    plan: "",
    branch: "b",
    status,
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
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

function ev(id: number, type: string, payload: unknown, timestamp = AT) {
  return { id, type, payload, timestamp } as unknown as RunEvent;
}

function log(container: HTMLElement) {
  return within(container).getByRole("log");
}

describe("the run chat shows real events and nothing invented", () => {
  it("shows no greeting or agent prose before any event arrives", () => {
    const { container } = render(
      <RunChat run={makeRun("planning")} events={[]} />,
    );
    expect(container.textContent).not.toContain("Starting run for");
    expect(container.textContent).not.toContain("I'm");
    expect(
      within(log(container)).getByText("Waiting for the first update…"),
    ).toBeTruthy();
  });

  it("shows a status change as a system line with the map's label", () => {
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_plan_approval")}
        events={[
          ev(1, "status", { status: "awaiting_plan_approval", text: "raw" }),
        ]}
      />,
    );
    const system = within(log(container)).getByText("Review the plan");
    expect(system.closest("[data-kind]")?.getAttribute("data-kind")).toBe(
      "status",
    );
    expect(container.textContent).not.toContain("raw");
  });

  it("shows the plan, the diff summary and review activity from their events", () => {
    const events = [
      ev(1, "plan_ready", { plan: "Step one, then step two" }),
      ev(2, "diff_summary", {
        files: [{ path: "src/a.ts", added: 4, removed: 1 }],
        totalAdded: 4,
        totalRemoved: 1,
      }),
      ev(3, "review_activity", { tool: "read_file" }),
      ev(4, "review_activity", { text: "The tests cover the change." }),
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_review")} events={events} />,
    );
    const chat = within(log(container));
    expect(chat.getByText("Step one, then step two")).toBeTruthy();
    expect(chat.getByRole("button", { name: /src\/a\.ts/ })).toBeTruthy();
    expect(chat.getByText("+4")).toBeTruthy();
    expect(chat.getByText("−1")).toBeTruthy();
    expect(chat.getByText("Ran read_file")).toBeTruthy();
    expect(chat.getByText("The tests cover the change.")).toBeTruthy();
  });

  it("shows a structured failure with what happened and how to recover", () => {
    const failure = {
      category: "model",
      message: "The model call failed.",
      recovery: "Check the model connection in Settings, then restart the run.",
    };
    const { container } = render(
      <RunChat
        run={makeRun("failed")}
        events={[ev(1, "status", { status: "failed", failure })]}
      />,
    );
    const chat = within(log(container));
    expect(chat.getByText("The model call failed.")).toBeTruthy();
    expect(chat.getByText(failure.recovery)).toBeTruthy();
  });

  it("drops an unknown event type without a trace", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "steer", { text: "old" })]}
      />,
    );
    expect(container.textContent).not.toContain("old");
    expect(
      within(log(container)).getByText("Waiting for the first update…"),
    ).toBeTruthy();
  });
});

describe("one clock for the run chat", () => {
  it("shows a recent time relatively and the exact time on hover", () => {
    const recent = new Date(Date.now() - 2 * 60_000).toISOString();
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "chat_agent", { text: "Hello" }, recent)]}
      />,
    );
    const time = container.querySelector(`time[datetime="${recent}"]`);
    expect(time?.textContent).toBe("2 min ago");
    expect(time?.getAttribute("title")).toBe(formatTimestamp(recent));
  });

  it("shows an old time as the exact time", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "chat_agent", { text: "Hi" }, AT)]}
      />,
    );
    const time = container.querySelector(`time[datetime="${AT}"]`);
    expect(time?.textContent).toBe(formatTimestamp(AT));
  });
});

describe("progress lines group and collapse", () => {
  it("folds a long run of progress lines into one group with a count", () => {
    const events = [1, 2, 3, 4].map((i) =>
      ev(i, "ralph_progress", { text: `step ${i}`, iteration: i }),
    );
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    const group = container.querySelector("details");
    expect(group).not.toBeNull();
    expect(group?.querySelector("summary")?.textContent).toBe(
      "4 progress updates",
    );
    expect(group?.open).toBe(false);
  });

  it("keeps a short run of progress lines visible", () => {
    const events = [1, 2].map((i) =>
      ev(i, "ralph_progress", { text: `step ${i}`, iteration: i }),
    );
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    expect(container.querySelector("details")).toBeNull();
    expect(within(log(container)).getByText("step 2")).toBeTruthy();
  });
});

describe("scroll position and Jump to latest", () => {
  it("follows new items while at the bottom and offers Jump to latest after scrolling up", () => {
    const events = [ev(1, "chat_agent", { text: "first" })];
    const { container, rerender } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    const list = log(container);
    Object.defineProperty(list, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(list, "clientHeight", {
      value: 200,
      configurable: true,
    });
    list.scrollTop = 0;
    fireEvent.scroll(list);

    rerender(
      <RunChat
        run={makeRun("executing")}
        events={[...events, ev(2, "chat_agent", { text: "second" })]}
      />,
    );
    expect(list.scrollTop).toBe(0);
    const jump = within(container).getByRole("button", {
      name: "Jump to latest",
    });
    expect(jump).toBeTruthy();

    fireEvent.click(jump);
    expect(list.scrollTop).toBe(1000);
    expect(
      within(container).queryByRole("button", { name: "Jump to latest" }),
    ).toBeNull();
  });

  it("only announces new items, and only additions", () => {
    const { container } = render(
      <RunChat run={makeRun("executing")} events={[]} />,
    );
    expect(log(container).getAttribute("aria-relevant")).toBe("additions");
    expect(log(container).getAttribute("aria-live")).toBe("polite");
  });
});

describe("approval actions follow the status map and the policy", () => {
  it("offers the map's labels on each gate, and Approved on click", () => {
    const onAction = mock(() => {});
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_plan_approval")}
        events={[]}
        onAction={onAction}
      />,
    );
    const approve = within(container).getByRole("button", {
      name: "Approve Plan",
    });
    expect(
      within(container).getByRole("button", { name: "Request Changes" }),
    ).toBeTruthy();
    fireEvent.click(approve);
    expect(onAction).toHaveBeenCalledWith("approve");
    expect(container.textContent).toContain("Approved");
  });

  it("offers no approval on a status that has none", () => {
    const { container } = render(
      <RunChat run={makeRun("recovery_required")} events={[]} />,
    );
    expect(
      within(container).queryByRole("button", { name: /approve/i }),
    ).toBeNull();
    expect(container.textContent).toContain("Needs recovery");
  });
});

describe("a failed reply is a system line, never an agent message", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("says the model could not be reached, and no agent wrote it", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const input = within(container).getByRole("textbox") as HTMLInputElement;
    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "Why this plan?" } });
      fireEvent.keyUp(input);
    });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    expect(
      within(container).getByText(
        "Couldn't reach the model. Check Settings › Models.",
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("sorry");
    expect(container.textContent).not.toContain("Sorry");
  });
});

describe("every kind of run event reads as its own line", () => {
  it("shows evidence, stage starts, pull request links, errors and results", () => {
    const events = [
      ev(1, "stage_evidence", {
        stage: "execute",
        evidence: "bun test passed",
      }),
      ev(2, "stage_started", {
        stage: "execute",
        attempt: 1,
        model: {
          role: "builder",
          connectionId: "c",
          connectionName: "Gemini",
          apiType: "x",
          modelId: "gemini-x",
        },
      }),
      ev(3, "pr_step", {
        step: "pr",
        url: "https://github.com/x/y/pull/7",
        text: "Pull request opened",
      }),
      ev(4, "error", { message: "Disk full" }),
      ev(5, "verification", {
        result: { passed: true, summary: "All checks green" },
      }),
      ev(6, "review", { result: { passed: false, summary: "Missing a test" } }),
    ];
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    const chat = within(log(container));
    expect(chat.getByText("bun test passed", { exact: false })).toBeTruthy();
    expect(chat.getByText("Coding with gemini-x via Gemini")).toBeTruthy();
    const link = chat.getByRole("link", { name: "Pull request opened" });
    expect(link.getAttribute("href")).toBe("https://github.com/x/y/pull/7");
    expect(chat.getByText("Disk full")).toBeTruthy();
    expect(
      chat.getByText("Verification passed", { exact: false }),
    ).toBeTruthy();
    expect(
      chat.getByText("Review did not pass", { exact: false }),
    ).toBeTruthy();
  });

  it("shows reviewer activity text, builder and reviewer output, and the user's own message", () => {
    const events = [
      ev(1, "review_activity", { text: "The tests cover the change." }),
      ev(2, "pi_output_chunk", { role: "pi", text: "Writing the parser" }),
      ev(3, "pi_output_chunk", { role: "reviewer", text: "Looks fine to me" }),
      ev(4, "chat_user", { text: "Why this plan?" }),
      ev(5, "chat_agent", { text: "Because it is small." }),
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={events} />,
    );
    const chat = within(log(container));
    expect(chat.getByText("The tests cover the change.")).toBeTruthy();
    expect(chat.getByText("Builder")).toBeTruthy();
    expect(chat.getByText("Reviewer")).toBeTruthy();
    expect(chat.getByText("Writing the parser")).toBeTruthy();
    expect(chat.getByText("Why this plan?")).toBeTruthy();
    expect(chat.getByText("Because it is small.")).toBeTruthy();
  });

  it("shows the unsandboxed warning as a notice", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[
          ev(1, "info", {
            text: "Running without a sandbox.",
            warning: "unsandboxed",
          }),
        ]}
      />,
    );
    expect(
      within(log(container)).getByText("Running without a sandbox."),
    ).toBeTruthy();
  });
});

describe("the composer: multi-line, keyboard-first, honest about failures (#263)", () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; body: string }>;
  let respond: () => Promise<Response>;

  beforeEach(() => {
    calls = [];
    respond = async () =>
      new Response(JSON.stringify({ ok: true, message: "Because." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return respond();
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function typeInto(el: HTMLElement, value: string) {
    act(() => {
      el.focus();
      fireEvent.change(el, { target: { value } });
      fireEvent.keyUp(el);
    });
  }

  function composer(container: HTMLElement) {
    return within(container).getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
  }

  it("offers no Start Chat gate on any status", () => {
    for (const status of [
      "planning",
      "executing",
      "awaiting_plan_approval",
    ] as RunStatus[]) {
      const { container, unmount } = render(
        <RunChat run={makeRun(status)} events={[]} />,
      );
      expect(
        within(container).queryByRole("button", { name: /start chat/i }),
      ).toBeNull();
      unmount();
    }
  });

  it("sends on Return, adds a line on Shift-Return, and sends on Mod-Enter", async () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const field = composer(container);

    typeInto(field, "First line");
    let shiftNotPrevented = true;
    act(() => {
      shiftNotPrevented = fireEvent.keyDown(field, {
        key: "Enter",
        shiftKey: true,
      });
    });
    expect(shiftNotPrevented).toBe(true);
    expect(calls).toHaveLength(0);

    typeInto(field, "Why this plan?");
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      message: "Why this plan?",
    });

    typeInto(field, "Second question");
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      message: "Second question",
    });
  });

  it("shows a typing indicator while the reply is pending, and removes it when the reply lands", async () => {
    let finish: () => void = () => {};
    respond = () =>
      new Promise<Response>((resolve) => {
        finish = () =>
          resolve(
            new Response(JSON.stringify({ ok: true, message: "Because." }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
      });
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    typeInto(composer(container), "Why?");
    await act(async () => {
      fireEvent.submit(composer(container).closest("form") as HTMLFormElement);
    });
    expect(
      within(container).getByRole("status", { name: "The agent is replying" }),
    ).toBeTruthy();

    await act(async () => {
      finish();
    });
    expect(
      within(container).queryByRole("status", {
        name: "The agent is replying",
      }),
    ).toBeNull();
  });

  it("shows a refused reply as a system line with Retry, and Retry only re-sends the message", async () => {
    respond = async () =>
      new Response(
        JSON.stringify({
          ok: false,
          message:
            "Couldn't reach the model: Builder has no model. Choose a model in Settings › Models.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    typeInto(composer(container), "Why this plan?");
    await act(async () => {
      fireEvent.submit(composer(container).closest("form") as HTMLFormElement);
    });

    const alert = within(container).getByRole("alert");
    expect(alert.textContent).toContain("Builder has no model");
    expect(alert.textContent).not.toContain("trouble connecting");
    expect(within(log(container)).queryByText("Why this plan?")).not.toBeNull();

    respond = async () =>
      new Response(JSON.stringify({ ok: true, message: "Because." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await act(async () => {
      fireEvent.click(within(container).getByRole("button", { name: "Retry" }));
    });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      message: "Why this plan?",
    });
    expect(within(log(container)).getAllByText("Why this plan?")).toHaveLength(
      1,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("offers Retry on a recorded failure, re-sending the message before it", async () => {
    const events = [
      ev(1, "chat_user", { text: "Why this plan?" }),
      ev(2, "error", {
        message: "The model is rate limited. Wait a moment, then Retry.",
      }),
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={events} />,
    );
    const chat = within(log(container));
    expect(
      chat.getByText("The model is rate limited. Wait a moment, then Retry."),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(chat.getByRole("button", { name: "Retry" }));
    });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      message: "Why this plan?",
    });
  });

  it("keeps the checkpoint bar directly above the message box", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const bar = within(container).getByRole("region", { name: "Checkpoint" });
    expect(bar.nextElementSibling?.tagName).toBe("FORM");
    expect(bar.nextElementSibling?.contains(composer(container))).toBe(true);
  });
});
