// test/performance-spike.test.ts — XF-025 Performance Spike: Durable SQLite events & subprocess buffer capping.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { SSEStreamRegistry } from "../src/http/sse-registry.js";
import { execCommand } from "../src/proc.js";

describe("XF-025 Performance Spike: SSE Fan-out & Subprocess Buffering", () => {
  it("profiles SQLite durable event append and query under concurrent load", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const repo = new EventRepository(db);

    const NUM_RUNS = 10;
    const EVENTS_PER_RUN = 50;

    for (let r = 0; r < NUM_RUNS; r++) {
      runRepo.create({
        id: `perf-run-${r}`,
        projectId: "perf-proj",
        projectName: "Perf Project",
        ticket: {
          id: `T-${r}`,
          title: `Perf Ticket ${r}`,
          acceptanceCriteria: [],
        },
        plan: "Plan",
        branch: `factory/perf-${r}`,
        status: "implementing",
        artifactsDir: "/tmp",
        worktreePath: "/tmp",
      });
    }

    const startTime = performance.now();
    for (let i = 0; i < EVENTS_PER_RUN; i++) {
      for (let r = 0; r < NUM_RUNS; r++) {
        repo.appendEvent(`perf-run-${r}`, "info", {
          text: `Event ${i}`,
        });
      }
    }
    const duration = performance.now() - startTime;

    for (let r = 0; r < NUM_RUNS; r++) {
      const events = repo.getEventsForRun(`perf-run-${r}`);
      expect(events.length).toBe(EVENTS_PER_RUN);
      expect(events[0]?.sequence).toBe(1);
      expect(events[EVENTS_PER_RUN - 1]?.sequence).toBe(EVENTS_PER_RUN);
    }

    expect(duration).toBeLessThan(5000);
  });

  it("verifies clean subscriber cleanup in SSEStreamRegistry across repeated connect/disconnect cycles", () => {
    const registry = new SSEStreamRegistry();
    const CYCLES = 1000;

    for (let i = 0; i < CYCLES; i++) {
      const unsub = registry.register(() => {});
      unsub();
    }

    expect(registry.count).toBe(0);
  });

  it("measures subprocess buffer-capping against high-volume output stream", async () => {
    // Generate ~5 MB of stdout output (100,000 lines of text)
    const script =
      "for(let i=0; i<100000; i++) console.log('X-FACTORY-HIGH-VOLUME-STREAM-CHUNK-' + i);";
    const maxChars = 20_000;

    const start = performance.now();
    const result = await execCommand("bun", ["-e", script], {
      maxBufferChars: maxChars,
      timeoutMs: 15_000,
    });
    const elapsed = performance.now() - start;

    console.log("\n--- XF-025 Subprocess Buffer-Capping Results ---");
    console.log(`Stream produced: 100,000 lines (~3.5 MB raw text)`);
    console.log(`Capped Buffer Length: ${result.stdout.length} chars`);
    console.log(
      `Truncation Marker Present: ${result.stdout.includes("[output truncated]")}`,
    );
    console.log(`Execution Time: ${elapsed.toFixed(2)}ms`);
    console.log(`Exit Code: ${result.exitCode}`);
    console.log("----------------------------------------------\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThan(maxChars + 100);
    expect(result.stdout).toContain("... [output truncated]");
  });
});
