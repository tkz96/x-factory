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
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import { RunDetailsProvider } from "../src/frontend/components/runs/RunDetailsContext.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import {
  formatClockTime,
  formatTimestamp,
} from "../src/frontend/lib/format-timestamp.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { RunDetailView } from "../src/frontend/views/RunDetailView.js";
import type { Run, RunEvent, RunStatus } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

describe("the run chat shows real events and nothing invented", () => {
  it("shows no greeting or agent prose before any event arrives", () => {
    const { container } = render(
      <RunChat run={makeRun("planning")} events={[]} />,
    );
    expect(container.textContent).not.toContain("Starting run for");
    expect(container.textContent).not.toContain("I'm");
    expect(container.textContent).not.toContain(
      "Waiting for the first update…",
    );
    expect(within(log(container)).getByText("Planning")).toBeTruthy();
  });

  it("shows a status change as a system line with the map's label", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "status", { status: "executing", text: "raw" })]}
      />,
    );
    const system = within(log(container)).getByText("Writing code", {
      selector: "[data-kind] > span",
    });
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
    // The diff is one summary line; the file list lives in Run details (run page plan, 1b).
    expect(chat.getByText("1 file changed")).toBeTruthy();
    expect(chat.queryByRole("button", { name: /src\/a\.ts/ })).toBeNull();
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
    // The decision card states the failure and its recovery once; the log's status line does not
    // say it again.
    const page = within(container);
    expect(page.getAllByText("The model call failed.")).toHaveLength(1);
    expect(page.getAllByText(failure.recovery)).toHaveLength(1);
    expect(
      log(container).querySelector('[data-kind="status"]')?.textContent,
    ).not.toContain("The model call failed.");
    // The log still records the moment the run failed.
    expect(
      log(container).querySelector('[data-kind="status"]')?.textContent,
    ).toContain("Failed");
  });

  it("keeps an earlier failure in the log once the run has moved on", () => {
    const failure = {
      category: "model",
      message: "The model call failed.",
      recovery: "Check the model connection in Settings, then restart the run.",
    };
    const { container } = render(
      <RunChat
        run={makeRun("understanding")}
        events={[
          ev(1, "status", { status: "failed", failure }),
          ev(2, "status", { status: "understanding" }),
        ]}
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
    expect(container.textContent).not.toContain(
      "Waiting for the first update…",
    );
    expect(within(log(container)).getByText("Writing code")).toBeTruthy();
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

  it("shows an old time as the time of day, with the exact time on hover", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "chat_agent", { text: "Hi" }, AT)]}
      />,
    );
    const time = container.querySelector(`time[datetime="${AT}"]`);
    expect(time?.textContent).toBe(formatClockTime(AT));
    expect(time?.getAttribute("title")).toBe(formatTimestamp(AT));
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
    const toggle = container.querySelector<HTMLElement>(
      ".run-chat-group .run-disclosure",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toBe("4 agent updates");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a short run of progress lines visible", () => {
    const events = [1, 2].map((i) =>
      ev(i, "ralph_progress", { text: `step ${i}`, iteration: i }),
    );
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    expect(container.querySelector(".run-chat-group")).toBeNull();
    expect(within(log(container)).getByText("step 2")).toBeTruthy();
  });

  it("folds the Reviewer's tool calls with the agent updates, and opens on press", () => {
    const events = [
      ev(1, "review_activity", { tool: "read", text: "Running tool read" }),
      ev(2, "review_activity", { tool: "read", text: "Running tool read" }),
      ev(3, "review_activity", { text: "CRITERIA_CHECK: all pass" }),
    ];
    const { container } = render(
      <RunChat run={makeRun("executing")} events={events} />,
    );
    const toggle = container.querySelector<HTMLElement>(
      ".run-chat-group .run-disclosure",
    );
    expect(toggle?.textContent).toBe("3 agent updates");
    const body = container.querySelector<HTMLElement>(".run-chat-group-body");
    expect(body?.hidden).toBe(true);
    if (toggle) fireEvent.click(toggle);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);
  });
});

describe("scroll position and Jump to Latest", () => {
  it("follows new items while at the bottom and offers Jump to Latest after scrolling up", () => {
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
      name: "Jump to Latest",
    });
    expect(jump).toBeTruthy();

    fireEvent.click(jump);
    expect(list.scrollTop).toBe(1000);
    expect(
      within(container).queryByRole("button", { name: "Jump to Latest" }),
    ).toBeNull();
  });

  it("brings the newest item into view when the content grows, while at the end", () => {
    const callbacks: Array<() => void> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const shown: string[] = [];
    const proto = HTMLElement.prototype as unknown as {
      scrollIntoView?: (arg?: unknown) => void;
    };
    const originalScrollIntoView = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) {
      shown.push(this.textContent ?? "");
    };
    try {
      const { container } = render(
        <RunChat
          run={makeRun("executing")}
          events={[
            ev(1, "status", { status: "executing" }),
            ev(2, "chat_agent", { text: "first" }),
            ev(3, "chat_agent", { text: "newest row" }),
          ]}
        />,
      );
      const list = log(container);
      Object.defineProperty(list, "scrollHeight", {
        value: 1500,
        configurable: true,
      });
      Object.defineProperty(list, "clientHeight", {
        value: 200,
        configurable: true,
      });
      shown.length = 0;
      for (const callback of callbacks) callback();
      // The newest item scrolls into view, not the bottom of the list.
      expect(shown.at(-1)).toContain("newest row");
      expect(list.scrollTop).toBe(0);

      // Up the chat, growth does not move the reader.
      shown.length = 0;
      fireEvent.scroll(list);
      list.scrollTop = 0;
      Object.defineProperty(list, "scrollHeight", {
        value: 3000,
        configurable: true,
      });
      fireEvent.scroll(list);
      for (const callback of callbacks) callback();
      expect(shown).toEqual([]);
    } finally {
      globalThis.ResizeObserver = original;
      if (originalScrollIntoView) proto.scrollIntoView = originalScrollIntoView;
      else delete proto.scrollIntoView;
    }
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
    const actions: string[] = [];
    const onAction = (action: string) => actions.push(action);
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
    expect(actions).toContain("approve");
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
      <MemoryRouter>
        <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />
      </MemoryRouter>,
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
    // The pointer is a link, so the sentence is split across elements.
    expect(within(container).getByRole("alert").textContent).toContain(
      "Couldn't reach the model. Check Settings › Models.",
    );
    expect(
      within(container)
        .getByRole("link", { name: "Settings › Models" })
        .getAttribute("href"),
    ).toBe("/settings?tab=models");
    expect(container.textContent).not.toContain("sorry");
    expect(container.textContent).not.toContain("Sorry");
  });
});

describe("Abandon Run asks first (#262)", () => {
  it("confirms in an alert naming the branch, and acts only on confirm", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("recovery_required", { branch: "feat/login" })}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Abandon Run" }),
    );
    const alert = within(document.body).getByRole("alertdialog");
    expect(alert.textContent).toContain("feat/login");
    expect(actions).toEqual([]);

    fireEvent.click(within(alert).getByRole("button", { name: "Abandon Run" }));
    expect(actions).toEqual(["abandon"]);
  });

  it("does nothing when the user keeps the run", () => {
    const actions: string[] = [];
    const { container } = render(
      <RunChat
        run={makeRun("recovery_required")}
        events={[]}
        onAction={(action) => actions.push(action)}
      />,
    );
    fireEvent.click(
      within(container).getByRole("button", { name: "Abandon Run" }),
    );
    fireEvent.click(
      within(within(document.body).getByRole("alertdialog")).getByRole(
        "button",
        { name: "Keep Run" },
      ),
    );
    expect(actions).toEqual([]);
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
    // The Builder's output and the Builder's chat reply each name the speaker above their text.
    expect(chat.getAllByText("Builder").length).toBe(2);
    expect(chat.getByText("Reviewer")).toBeTruthy();
    expect(chat.getByText("Writing the parser")).toBeTruthy();
    expect(chat.getByText("Why this plan?")).toBeTruthy();
    expect(chat.getByText("Because it is small.")).toBeTruthy();
  });

  it("renders the Builder's chat reply as Markdown, never raw HTML", () => {
    const events = [
      ev(1, "chat_user", { text: "Which `files`?" }),
      ev(2, "chat_agent", {
        text: "`calc.ts` and **`calc.test.ts`**.\n\n<img src=x onerror=alert(1)>",
      }),
    ];
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_understanding_approval")}
        events={events}
      />,
    );
    const reply = log(container).querySelectorAll('[data-kind="message"]')[1];
    if (!reply) throw new Error("the reply is missing");
    const codes = Array.from(reply.querySelectorAll("code")).map(
      (c) => c.textContent,
    );
    expect(codes).toContain("calc.ts");
    expect(reply.textContent).not.toContain("`calc.ts`");
    // Raw HTML stays text: no element is made from it.
    expect(reply.querySelector("img")).toBeNull();
    expect(reply.textContent).toContain("<img src=x onerror=alert(1)>");
    // The reader's own message is shown as typed.
    const own = log(container).querySelectorAll('[data-kind="message"]')[0];
    expect(own?.textContent).toContain("Which `files`?");
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
      <MemoryRouter>
        <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />
      </MemoryRouter>,
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

  it("offers Retry on a recorded failure even when no earlier message is in the chat", async () => {
    const run = makeRun("awaiting_plan_approval");
    const view = render(<RunChat run={run} events={[]} />);
    typeInto(composer(view.container), "Why this plan?");
    await act(async () => {
      fireEvent.submit(
        composer(view.container).closest("form") as HTMLFormElement,
      );
    });
    expect(calls).toHaveLength(1);
    view.rerender(
      <RunChat
        run={run}
        events={[ev(1, "error", { message: "The model is rate limited." })]}
      />,
    );
    await act(async () => {
      fireEvent.click(
        within(log(view.container)).getByRole("button", { name: "Retry" }),
      );
    });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      message: "Why this plan?",
    });
  });

  it("keeps the checkpoint bar inside the decision card, in the current stage, above the message box", () => {
    const { container } = render(
      <RunChat run={makeRun("awaiting_plan_approval")} events={[]} />,
    );
    const bar = within(container).getByRole("region", { name: "Checkpoint" });
    expect(bar.closest(".run-decision")).not.toBeNull();
    expect(bar.closest('li[data-state="current"]')).not.toBeNull();
    // The message box comes after the timeline that holds the card.
    expect(
      bar.compareDocumentPosition(composer(container)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("run chat text reads as Markdown and sits at the start of a stage", () => {
  it("shows the plan card as a Markdown preview, with the source one click away", () => {
    const plan = "# Execution Plan\n\n## Context\n\n- Touch `settings.tsx`";
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_plan_approval")}
        events={[ev(1, "plan_ready", { plan })]}
      />,
    );
    const card =
      log(container).querySelector<HTMLElement>('[data-kind="plan"]');
    if (!card) throw new Error("the plan card is missing");
    expect(card.querySelector(".md-block-label")?.textContent).toBe("Plan");
    expect(
      within(card).getByRole("heading", { level: 1, name: "Execution Plan" }),
    ).toBeTruthy();
    expect(card.querySelector("code")?.textContent).toBe("settings.tsx");
    expect(card.textContent).not.toContain("# Execution");
    fireEvent.click(within(card).getByRole("radio", { name: "Raw" }));
    expect(card.querySelector("pre.md-block-raw")?.textContent).toBe(plan);
  });

  it("reads evidence as Markdown, without repeating the stage name its stage header shows", () => {
    const { container } = render(
      <RunChat
        run={makeRun("awaiting_understanding_approval")}
        events={[
          ev(1, "stage_evidence", {
            stage: "understand",
            evidence: "**Scope:** the settings page",
          }),
        ]}
      />,
    );
    const row = log(container).querySelector<HTMLElement>(
      '[data-kind="evidence"]',
    );
    if (!row) throw new Error("the evidence row is missing");
    expect(row.querySelector(".md-block-label")).toBeNull();
    expect(row.textContent).not.toContain("Understand");
    expect(row.querySelector("strong")?.textContent).toBe("Scope:");
    expect(row.textContent).not.toContain("**");
  });

  it("shows each stage summary as its own line, whatever the stage is called", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[
          ev(1, "stage_evidence", {
            stage: "prepare",
            evidence: "Worktree ready at external path",
          }),
          ev(2, "stage_evidence", { stage: "custom_step", evidence: "done" }),
        ]}
      />,
    );
    const rows = log(container).querySelectorAll<HTMLElement>(
      '[data-kind="evidence"]',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Worktree ready at external path");
    expect(rows[1]?.textContent).toContain("done");
  });

  it("reads Builder output as Markdown and keeps the speaker's name above it", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[
          ev(1, "pi_output_chunk", {
            role: "pi",
            text: "## Writing\n\n- parser",
          }),
        ]}
      />,
    );
    const bubble = log(container).querySelector<HTMLElement>(
      '[data-kind="output"]',
    );
    if (!bubble) throw new Error("the output bubble is missing");
    expect(bubble.querySelector(".run-chat-speaker")?.textContent).toBe(
      "Builder",
    );
    expect(
      within(bubble).getByRole("heading", { level: 2, name: "Writing" }),
    ).toBeTruthy();
    expect(within(bubble).getByRole("listitem").textContent).toBe("parser");
  });

  it("keeps the user's own message as typed, with no Markdown rendering", () => {
    const { container } = render(
      <RunChat
        run={makeRun("executing")}
        events={[ev(1, "chat_user", { text: "## not a heading" })]}
      />,
    );
    const own = log(container).querySelector<HTMLElement>(
      '[data-kind="message"]',
    );
    expect(own?.querySelector("h2")).toBeNull();
    expect(own?.textContent).toContain("## not a heading");
    expect(own?.querySelector(".md-block")).toBeNull();
  });

  it("left-aligns stage lines, cards and bubbles, and keeps the warning and error tones", async () => {
    const css = await Bun.file(
      new URL("../src/frontend/components/runs/RunChat.css", import.meta.url),
    ).text();
    const system = /\.run-chat-system \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(system).toContain("justify-content: flex-start");
    expect(system).toContain("text-align: start");
    expect(system).not.toMatch(/justify-content: center|text-align: center/);
    const card = /\.run-chat-messages \.ui-card \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(card).toContain("text-align: start");
    expect(css).toContain(".run-chat-system-warning");
    expect(css).toContain(".run-chat-system-error");
  });
});

describe("the chat state of one run does not follow the reader into the next", () => {
  const realFetch = globalThis.fetch;
  const RealEventSource = (globalThis as { EventSource?: unknown }).EventSource;

  class FakeEventSource {
    constructor(public url: string) {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      RealEventSource;
  });

  /** Renders the run page for run-1 on the app's data router (see src/frontend/routes.tsx), with
   * run-1 and run-2 both seeded in the query cache. */
  function renderRunPage(
    onNavigate: (router: ReturnType<typeof createMemoryRouter>) => void,
  ) {
    globalThis.fetch = (async () =>
      json(
        makeRun("awaiting_plan_approval", { id: "run-2" }),
      )) as unknown as typeof fetch;
    (globalThis as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    for (const id of ["run-1", "run-2"]) {
      client.setQueryData(
        queryKeys.run(id),
        makeRun("awaiting_plan_approval", { id }),
      );
      client.setQueryData(queryKeys.runEvents(id), []);
    }
    const router = createMemoryRouter(
      [{ path: "/runs/:runId", element: <RunDetailView /> }],
      { initialEntries: ["/runs/run-1"] },
    );
    const view = render(
      <QueryClientProvider client={client}>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </QueryClientProvider>,
    );
    onNavigate(router);
    return view;
  }

  it("leaves the composer's draft behind when the reader moves to another run", async () => {
    let toRun2: () => Promise<void> = () => Promise.resolve();
    const { container } = renderRunPage((router) => {
      toRun2 = () => router.navigate("/runs/run-2");
    });

    const composer = (): HTMLTextAreaElement => {
      const area = container.querySelector("form.run-chat-input textarea");
      if (!area) throw new Error("the composer is missing");
      return area as HTMLTextAreaElement;
    };
    await waitFor(() => expect(composer().disabled).toBe(false));
    // Typing the way the browser does (focus, change, keyup, as add-project-assistant's typeInput):
    // a bare fireEvent.change never reaches the composer's onChange under happy-dom.
    act(() => {
      composer().focus();
      fireEvent.change(composer(), {
        target: { value: "a note made on run 1" },
      });
      fireEvent.keyUp(composer());
    });
    expect(composer().value).toBe("a note made on run 1");

    await act(async () => {
      await toRun2();
    });

    await waitFor(() => expect(composer().value).toBe(""));
  });
});

describe("summary lines open their section in Run details (run page plan, 1b)", () => {
  it("brings the Files section into view and focus when the changes line is pressed", () => {
    const events = [
      ev(1, "diff_summary", {
        files: [{ path: "src/a.ts", added: 4, removed: 1 }],
        totalAdded: 4,
        totalRemoved: 1,
      }),
    ];
    const { container } = render(
      <RunDetailsProvider isPhone={false}>
        <h3 id="run-inspector-files">Files</h3>
        <RunChat run={makeRun("awaiting_review")} events={events} />
      </RunDetailsProvider>,
    );
    const line = within(log(container)).getByRole("button", {
      name: /1 file changed/,
    });
    fireEvent.click(line);
    expect(document.activeElement?.id).toBe("run-inspector-files");
  });

  it("stays plain text where no Run details pane exists", () => {
    const events = [
      ev(1, "diff_summary", { files: [], totalAdded: 0, totalRemoved: 0 }),
    ];
    const { container } = render(
      <RunChat run={makeRun("awaiting_review")} events={events} />,
    );
    expect(
      within(log(container)).queryByRole("button", { name: /changed/ }),
    ).toBeNull();
  });
});
