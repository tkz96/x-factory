// test/queue-view.test.ts — Verification for Work Queue toolbar and refresh action.

import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("Work Queue View & Refresh Controls", () => {
  it("includes a dedicated refresh button with accessible attributes in queue template", async () => {
    const queueViewPath = path.join(
      import.meta.dir,
      "../public/js/views/queue.ts",
    );
    const content = await Bun.file(queueViewPath).text();

    expect(content).toContain('id="btn-queue-refresh"');
    expect(content).toContain('aria-label="Refresh work queue"');
    expect(content).toContain("btn-secondary btn-sm");
    expect(content).toContain("Refresh");
  });

  it("wires the refresh button in queue logic", async () => {
    const queueJsPath = path.join(import.meta.dir, "../public/js/queue.ts");
    const content = await Bun.file(queueJsPath).text();

    expect(content).toContain('$<HTMLButtonElement>("#btn-queue-refresh")');
    expect(content).toContain("btnQueueRefresh.disabled = true;");
    expect(content).toContain("btnQueueRefresh.disabled = false;");
    expect(content).toContain("btnQueueRefresh.addEventListener");
  });
});
