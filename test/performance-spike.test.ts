// test/performance-spike.test.ts — XF-025 Performance Spike: SSE fan-out & subprocess buffer capping.

import { describe, expect, it } from "bun:test";
import { RunEventBus } from "../src/events.js";
import { execCommand } from "../src/proc.js";

describe("XF-025 Performance Spike: SSE Fan-out & Subprocess Buffering", () => {
  it("profiles SSE fan-out latency and memory under concurrent load", () => {
    const bus = new RunEventBus();
    const NUM_RUNS = 10;
    const CLIENTS_PER_RUN = 20; // 200 concurrent SSE subscribers total
    const EVENTS_PER_RUN = 50; // 500 total events emitted

    const latencies: number[] = [];
    const unsubs: Array<() => void> = [];

    let currentSentAt = 0;
    // Setup M clients per run
    for (let r = 0; r < NUM_RUNS; r++) {
      const runId = `perf-run-${r}`;
      for (let c = 0; c < CLIENTS_PER_RUN; c++) {
        const unsub = bus.subscribe(runId, () => {
          const now = performance.now();
          const latency = Math.max(0, now - currentSentAt);
          latencies.push(latency);
        });
        unsubs.push(unsub);
      }
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;

    // Emit events across all runs
    const startTime = performance.now();
    for (let i = 0; i < EVENTS_PER_RUN; i++) {
      for (let r = 0; r < NUM_RUNS; r++) {
        const runId = `perf-run-${r}`;
        currentSentAt = performance.now();
        bus.emit(runId, {
          type: "status",
          status: "verifying",
          text: "Running verification stage",
        });
      }
    }
    const duration = performance.now() - startTime;

    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;
    const memDeltaMB = (memAfter - memBefore) / (1024 * 1024);

    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

    console.log("\n--- XF-025 SSE Fan-out Benchmark Results ---");
    console.log(`Total Events Emitted: ${NUM_RUNS * EVENTS_PER_RUN}`);
    console.log(`Total Deliveries: ${latencies.length} (200 subscribers)`);
    console.log(`Throughput Duration: ${duration.toFixed(2)}ms`);
    console.log(`Latency p50: ${p50.toFixed(4)}ms`);
    console.log(`Latency p95: ${p95.toFixed(4)}ms`);
    console.log(`Latency p99: ${p99.toFixed(4)}ms`);
    console.log(`Memory Delta: ${memDeltaMB.toFixed(3)} MB`);
    console.log("-------------------------------------------\n");

    // Clean up
    for (const unsub of unsubs) unsub();

    // Assertions
    expect(latencies.length).toBe(NUM_RUNS * CLIENTS_PER_RUN * EVENTS_PER_RUN);
    expect(p99).toBeLessThan(10); // Less than 10ms p99 delivery latency
    expect(memDeltaMB).toBeLessThan(5); // Less than 5MB heap delta
  });

  it("verifies clean subscriber cleanup across repeated connect/disconnect cycles", () => {
    const bus = new RunEventBus();
    const runId = "cleanup-run-id";
    const CYCLES = 1000;

    for (let i = 0; i < CYCLES; i++) {
      const unsub = bus.subscribe(runId, () => {});
      bus.emit(runId, { type: "info", text: "heartbeat" });
      unsub();
    }

    // Inspect bus listeners private map
    const listenersMap = (
      bus as unknown as { listeners: Map<string, Set<unknown>> }
    ).listeners;
    expect(listenersMap.has(runId)).toBe(false);
    expect(listenersMap.size).toBe(0);
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
