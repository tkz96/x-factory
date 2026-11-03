// test/truthful-diagnostics.test.tsx — the UI shows only what a check produced
// (spec #312 "Truthful UI", ticket #323). Settings › Diagnostics takes its
// database state and journal mode from readiness, lists the checks that need
// attention, and shows an error instead of zeros when a query fails. The
// toolbar's "Degraded" link and the readiness banner share one rule.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { AppShell } from "../src/frontend/components/AppShell.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";
import type {
  DiagnosticsResponse,
  ReadinessCheck,
  ReadinessResponse,
} from "../src/shared/types.js";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const AT = "2026-11-03T09:00:00.000Z";

const DIAGNOSTICS: DiagnosticsResponse = {
  status: "ok",
  system: { uptime: 42, nodeVersion: "v22", memory: {} },
  database: {
    status: "healthy",
    version: 9,
    runs: { total: 7, active: 0 },
    jobs: {
      total: 7,
      pending: 2,
      claimed: 1,
      completed: 4,
      failed: 0,
      stale: 0,
    },
  },
  worker: { status: "healthy", activeCount: 1, fleet: [] },
  timestamp: AT,
};

function readiness(
  overrides: Partial<ReadinessResponse> & { checks?: ReadinessCheck[] } = {},
): ReadinessResponse {
  return {
    ready: true,
    status: "ready",
    database: { status: "ready", version: 9, journalMode: "wal" },
    worker: { status: "ready", activeWorkers: 1 },
    checks: [{ name: "Database", status: "pass", message: "SQLite 9 (wal)" }],
    timestamp: AT,
    ...overrides,
  };
}

/** Routes the API the views read; a `null` answer makes that endpoint fail. */
function routeApi(answers: {
  diagnostics: unknown | null;
  readiness: unknown | null;
}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/diagnostics")) {
      return answers.diagnostics === null
        ? jsonResponse({ error: "boom" }, 500)
        : jsonResponse(answers.diagnostics);
    }
    if (url.includes("/api/readiness")) {
      return answers.readiness === null
        ? jsonResponse({ error: "boom" }, 500)
        : jsonResponse(answers.readiness);
    }
    if (url.includes("/api/settings")) return jsonResponse({});
    if (url.includes("/api/docs")) return jsonResponse({ categories: [] });
    return jsonResponse([]);
  }) as typeof fetch;
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSettingsDiagnostics() {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: client() },
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/settings?tab=diagnostics"] },
        React.createElement(
          ModalProvider,
          null,
          React.createElement(SettingsView),
        ),
      ),
    ),
  );
}

function renderShell() {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: client() },
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/tickets"] },
        React.createElement(AppShell),
      ),
    ),
  );
}

describe("Settings › Diagnostics reports what the checks produced (#323)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    routeApi({ diagnostics: DIAGNOSTICS, readiness: readiness() });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  it("names the journal mode the readiness check reported, not a fixed one", async () => {
    routeApi({
      diagnostics: DIAGNOSTICS,
      readiness: readiness({
        database: { status: "ready", version: 9, journalMode: "delete" },
      }),
    });
    const view = renderSettingsDiagnostics();

    await waitFor(() =>
      expect(view.container.textContent ?? "").toContain("DELETE mode · 7 runs"),
    );
    expect(view.container.textContent ?? "").not.toContain("WAL mode");
  });

  it("shows the database as Unavailable, without WAL mode, when readiness says so", async () => {
    routeApi({
      diagnostics: DIAGNOSTICS,
      readiness: readiness({
        ready: false,
        status: "unavailable",
        database: { status: "unavailable", error: "DATABASE_UNAVAILABLE" },
        checks: [
          {
            name: "Database",
            status: "fail",
            message: "Database connection unavailable",
          },
        ],
      }),
    });
    const view = renderSettingsDiagnostics();

    await waitFor(() =>
      expect(view.container.textContent ?? "").toContain("runs"),
    );
    const text = view.container.textContent ?? "";
    expect(text).not.toContain("WAL mode");
    expect(text).toContain("Unavailable");
  });

  it("lists each readiness check that needs attention, by name and message", async () => {
    routeApi({
      diagnostics: DIAGNOSTICS,
      readiness: readiness({
        ready: true,
        checks: [
          { name: "Database", status: "pass", message: "SQLite 9 (wal)" },
          {
            name: "Sandbox",
            status: "warn",
            message: "the coding agent runs without a sandbox",
          },
        ],
      }),
    });
    const view = renderSettingsDiagnostics();

    await waitFor(() =>
      expect(view.container.textContent ?? "").toContain(
        "the coding agent runs without a sandbox",
      ),
    );
    expect(view.container.textContent ?? "").toContain("Sandbox");
  });

  it("shows an error with a retry instead of zeros when diagnostics fails", async () => {
    routeApi({ diagnostics: null, readiness: readiness() });
    const view = renderSettingsDiagnostics();

    await waitFor(() =>
      expect(view.container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    const text = view.container.textContent ?? "";
    expect(text).not.toContain("Uptime 0s");
    expect(text).not.toContain("0 runs");
    expect(text).not.toContain("0 active worker");
    expect(text).not.toContain("Healthy");
  });
});

describe("the toolbar and the readiness banner share one attention rule (#323)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  it("offers the Degraded link when a check warns, even though the workbench is ready", async () => {
    routeApi({
      diagnostics: DIAGNOSTICS,
      readiness: readiness({
        ready: true,
        checks: [
          {
            name: "Sandbox",
            status: "warn",
            message: "the coding agent runs without a sandbox",
          },
        ],
      }),
    });
    const view = renderShell();

    await waitFor(() =>
      expect(view.container.querySelector(".toolbar-readiness")).not.toBeNull(),
    );
  });

  it("offers no link when every check passes", async () => {
    routeApi({ diagnostics: DIAGNOSTICS, readiness: readiness() });
    const view = renderShell();

    await waitFor(() =>
      expect(view.container.querySelector(".toolbar-search")).not.toBeNull(),
    );
    expect(view.container.querySelector(".toolbar-readiness")).toBeNull();
  });

  it("keeps the Degraded link on phone width (no desktop-only class)", async () => {
    routeApi({
      diagnostics: DIAGNOSTICS,
      readiness: readiness({ ready: false, status: "unavailable" }),
    });
    const view = renderShell();

    const link = await waitFor(() => {
      const found = view.container.querySelector(".toolbar-readiness");
      if (!found) throw new Error("no readiness link");
      return found;
    });
    expect(link.classList.contains("desktop-only")).toBe(false);
  });
});

afterAll(async () => {
  await unregisterHappyDom();
});
