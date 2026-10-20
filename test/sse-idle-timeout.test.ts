// test/sse-idle-timeout.test.ts — Every SSE keep-alive must fall well inside the server's idle timeout.
// Bun closes a socket silent for `idleTimeout` seconds; a stream whose keep-alive is longer than that
// is dropped and reconnected every ~10 s. Fast by design: no real-time waits.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_EVENTS_KEEPALIVE_MS } from "../src/http/app-event-hub.js";
import {
  SERVER_IDLE_TIMEOUT_S,
  SSE_KEEPALIVE_MS,
} from "../src/http/sse-timing.js";

const root = path.resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("SSE keep-alive versus the server idle timeout", () => {
  it("keeps both streams' keep-alive at most half the idle timeout", () => {
    const idleMs = SERVER_IDLE_TIMEOUT_S * 1000;
    expect(SSE_KEEPALIVE_MS).toBeLessThanOrEqual(idleMs / 2);
    expect(APP_EVENTS_KEEPALIVE_MS).toBeLessThanOrEqual(idleMs / 2);
  });

  it("stays within Bun's 255 s idleTimeout cap and above Bun's 10 s default", () => {
    expect(SERVER_IDLE_TIMEOUT_S).toBeGreaterThan(10);
    expect(SERVER_IDLE_TIMEOUT_S).toBeLessThanOrEqual(255);
  });

  it("uses one shared keep-alive for the app stream", () => {
    expect(APP_EVENTS_KEEPALIVE_MS).toBe(SSE_KEEPALIVE_MS);
  });

  it("passes the constant to Bun.serve and the run stream uses the shared keep-alive", () => {
    const server = read("src/server.ts");
    const serve = server.slice(server.indexOf("Bun.serve({"));
    expect(serve.slice(0, serve.indexOf("async fetch"))).toContain(
      "idleTimeout: SERVER_IDLE_TIMEOUT_S,",
    );
    expect(server).toContain(
      'import { SERVER_IDLE_TIMEOUT_S } from "./http/sse-timing.js";',
    );

    const runs = read("src/http/runs-controller.ts");
    expect(runs).toContain("}, SSE_KEEPALIVE_MS);");
    expect(runs).not.toMatch(/}, 15000\);/);
  });

  it("is accepted by Bun.serve as an idleTimeout", () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: SERVER_IDLE_TIMEOUT_S,
      fetch: () => new Response("ok"),
    });
    server.stop(true);
  });
});
