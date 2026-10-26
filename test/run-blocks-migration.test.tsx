// test/run-blocks-migration.test.tsx — The run page on the shared blocks (spec #292, migration row M6): the
// stage timeline draws its glyphs from the sprite, the run views claim the shell's page heading instead of
// drawing one, and the empty states of the run page are the EmptyState block.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { RunStageTimeline } from "../src/frontend/components/runs/RunStageTimeline.js";
import type { StageGroup } from "../src/frontend/lib/run-stages.js";
import type { WorkflowStage } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf-8");
}

describe("the stage timeline's glyphs", () => {
  it("are sprite symbols on the same stroke as the others, not inline paths", () => {
    const sprite = read("public/assets/icons/sprite.svg");
    for (const id of ["icon-stage-done", "icon-stage-chevron"]) {
      expect(sprite).toContain(`<symbol id="${id}"`);
    }
    // No glyph sets its own stroke: every one inherits --icon-stroke (1.5).
    expect(sprite).not.toContain("stroke-width");
    expect(read("src/frontend/styles/shared/icons.css")).toContain(
      "stroke-width: var(--icon-stroke)",
    );
    expect(read("src/frontend/styles/tokens.css")).toMatch(
      /--icon-stroke:\s*1\.5;/,
    );
    const timeline = read("src/frontend/components/runs/RunStageTimeline.tsx");
    expect(timeline).not.toContain("<path");
    expect(timeline).not.toContain("<circle");
    expect(timeline).not.toContain("sprite.svg#");
  });

  it("draws the done stage's check through the Icon block", () => {
    const group = (
      stage: WorkflowStage,
      state: StageGroup["state"],
    ): StageGroup => ({
      stage,
      label: stage,
      state,
      items: [],
      startedAt: null,
      endedAt: null,
      tookMs: null,
    });
    const { container } = render(
      <RunStageTimeline
        groups={[group("prepare", "done"), group("plan", "current")]}
        open={new Set<WorkflowStage>()}
        onToggle={() => {}}
        now={0}
        waiting={false}
      />,
    );
    const done = container.querySelector(
      'li[data-state="done"] .run-stage-check',
    );
    expect(done?.querySelector("use")?.getAttribute("href")).toBe(
      "/assets/icons/sprite.svg#icon-stage-done",
    );
    const current = container.querySelector('li[data-state="current"]');
    expect(current?.querySelector(".run-stage-check")).toBeNull();
  });
});

describe("the run views", () => {
  it("claim the shell's page heading and draw no page header of their own", () => {
    for (const view of [
      "src/frontend/views/RunsView.tsx",
      "src/frontend/views/RunDetailView.tsx",
    ]) {
      const source = read(view);
      expect(source).toContain("usePageHeader(");
      expect(source).not.toMatch(/<header\b/);
      expect(source).not.toMatch(/className="[^"]*empty/);
    }
  });
});
