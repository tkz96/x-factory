// test/readiness-banner.test.tsx — the readiness banner claims only what the
// readiness checks verified, and names every check that needs attention (#283).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { ReadinessBanner } from "../src/frontend/components/projects/ReadinessBanner.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import type { ReadinessResponse } from "../src/shared/types.js";

function readiness(
  checks: ReadinessResponse["checks"],
  ready = true,
): ReadinessResponse {
  return {
    ready,
    status: ready ? "ready" : "unavailable",
    database: { status: "ready", version: 9, journalMode: "wal" },
    worker: { status: "ready", activeWorkers: 1 },
    checks,
    timestamp: new Date(0).toISOString(),
  };
}

function renderBanner(data: ReadinessResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.readiness(), data);
  return render(
    <QueryClientProvider client={client}>
      <ReadinessBanner />
    </QueryClientProvider>,
  );
}

const PASSING = [
  { name: "Database", status: "pass" as const, message: "SQLite 9 (wal)" },
  { name: "Background Worker", status: "pass" as const, message: "1 worker" },
  { name: "Sandbox", status: "pass" as const, message: "sbx is installed." },
];

describe("ReadinessBanner (#283)", () => {
  afterEach(() => cleanup());

  it("when every check passes, it lists what was checked and claims nothing else", () => {
    const { container } = renderBanner(readiness(PASSING));
    const text = container.textContent ?? "";
    expect(text).toContain("Database");
    expect(text).toContain("Background Worker");
    expect(text).toContain("Sandbox");
    expect(text).not.toContain("CLI tools");
    expect(text).not.toContain("credentials verified");
  });

  it("names a failing sandbox check with its message instead of saying everything is ready", () => {
    const failing = [
      ...PASSING.slice(0, 2),
      {
        name: "Sandbox",
        status: "fail" as const,
        message:
          "sbx is not installed, so the coding stage will refuse to run.",
      },
    ];
    const { container } = renderBanner(readiness(failing));
    const text = container.textContent ?? "";
    expect(text).toContain("Needs attention");
    expect(text).toContain("sbx is not installed");
    expect(container.querySelector(".readiness-banner.warning")).not.toBeNull();
  });

  it("names a warning check too (running without a sandbox)", () => {
    const warning = [
      ...PASSING.slice(0, 2),
      {
        name: "Sandbox",
        status: "warn" as const,
        message: "the coding agent runs without a sandbox",
      },
    ];
    const text = renderBanner(readiness(warning)).container.textContent ?? "";
    expect(text).toContain("Needs attention");
    expect(text).toContain("runs without a sandbox");
  });
});

afterAll(async () => {
  await unregisterHappyDom();
});
