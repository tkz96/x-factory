// test/queue-view.test.ts — Verification for Work Queue toolbar and refresh action.

import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("Work Queue View & Refresh Controls", () => {
  it("includes a dedicated refresh button with accessible attributes in queue toolbar", async () => {
    const toolbarPath = path.join(
      import.meta.dir,
      "../src/frontend/components/queue/TicketSearchToolbar.tsx",
    );
    const content = await Bun.file(toolbarPath).text();

    expect(content).toContain('id="btn-queue-refresh"');
    expect(content).toContain('aria-label="Refresh work queue"');
    expect(content).toContain("btn-secondary btn-sm");
    expect(content).toContain("Refresh");
  });

  it("wires the refresh action to refetch tickets in queue view", async () => {
    const queueViewPath = path.join(
      import.meta.dir,
      "../src/frontend/views/QueueView.tsx",
    );
    const content = await Bun.file(queueViewPath).text();

    expect(content).toContain("onRefresh={() => refetch()}");
    expect(content).toContain("isRefreshing={isRefetching}");
    expect(content).toContain("useTickets(selectedProjectId)");
  });
});
