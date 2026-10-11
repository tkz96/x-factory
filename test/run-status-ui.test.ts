import { describe, expect, it } from "bun:test";
import {
  NEEDS_YOU_STATUSES,
  RUN_STATUS_UI,
  runStatusText,
} from "../src/frontend/lib/run-status-ui.js";
import {
  ACTIONS_BY_STATUS,
  AWAITING_HUMAN_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  TRANSITIONS,
} from "../src/shared/run-status-policy.js";
import type { RunStatus } from "../src/shared/types.js";

const ALL = Object.keys(TRANSITIONS) as RunStatus[];

describe("run status UI mapping", () => {
  it("covers every RunStatus", () => {
    expect(Object.keys(RUN_STATUS_UI).sort()).toEqual([...ALL].sort());
  });

  it("run actions equal the policy's allowed actions exactly, chat included", () => {
    for (const status of ALL) {
      expect({
        status,
        actions: RUN_STATUS_UI[status].actions.map((a) => a.action).sort(),
      }).toEqual({ status, actions: [...ACTIONS_BY_STATUS[status]].sort() });
    }
  });

  it("offers Start New Run only on terminal statuses", () => {
    for (const status of ALL) {
      expect(RUN_STATUS_UI[status].ticketCommand).toBe(
        TERMINAL_RUN_STATUSES.has(status) ? "Start New Run" : null,
      );
      expect(
        RUN_STATUS_UI[status].actions.some((a) => a.label === "Start New Run"),
      ).toBe(false);
    }
  });

  it("Needs you is the awaiting-human statuses plus recovery_required", () => {
    expect([...NEEDS_YOU_STATUSES].sort()).toEqual(
      (
        [...AWAITING_HUMAN_RUN_STATUSES, "recovery_required"] as RunStatus[]
      ).sort(),
    );
  });

  it("uses plain labels, never a raw status string", () => {
    for (const status of ALL) {
      const label = runStatusText(status);
      expect(label).not.toContain("_");
      expect(label).not.toBe(status);
    }
    expect(runStatusText("awaiting_plan_approval")).toBe("Review the plan");
    expect(RUN_STATUS_UI.awaiting_plan_approval.actions[0]?.label).toBe(
      "Approve Plan",
    );
    expect(RUN_STATUS_UI.awaiting_review.actions[0]?.label).toBe(
      "Approve Changes",
    );
  });
});
