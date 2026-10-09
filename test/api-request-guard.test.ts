// test/api-request-guard.test.ts — Local-only API boundary: Host, Origin and Content-Type guards at the handleApi seam.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { resolveListenHost } from "../src/http/request-guard.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

const PORT = 3777;
const API = `http://127.0.0.1:${PORT}/api/health`;
const LOOPBACK_GUARD = { port: PORT, listenHost: "127.0.0.1" };

function postTo(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Request {
  return new Request(url, {
    method: init.method ?? "POST",
    headers: new Headers(init.headers),
    body: init.body ?? null,
  });
}

async function send(
  req: Request,
  guard: { port: number; listenHost: string } = LOOPBACK_GUARD,
): Promise<Response> {
  return handleApi(req, new URL(req.url), undefined, guard);
}

describe("API request guard (local-only boundary)", () => {
  beforeEach(() => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
  });

  afterEach(() => {
    setDbForTesting(null);
  });

  describe("cross-origin state-changing requests", () => {
    it("rejects a POST from a foreign website with 403", async () => {
      const res = await send(
        postTo(API, {
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects a DELETE from a foreign website with 403", async () => {
      const res = await send(
        postTo(API, {
          method: "DELETE",
          headers: { Origin: "https://evil.example" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects an opaque null Origin on a POST with 403", async () => {
      const res = await send(postTo(API, { headers: { Origin: "null" } }));
      expect(res.status).toBe(403);
    });

    it("rejects a POST from a foreign origin on the same port with 403", async () => {
      const res = await send(
        postTo(API, { headers: { Origin: "http://evil.example:3777" } }),
      );
      expect(res.status).toBe(403);
    });

    it("allows a same-origin POST from the API origin", async () => {
      const res = await send(
        postTo(API, {
          headers: {
            Origin: "http://127.0.0.1:3777",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("allows a same-origin POST from localhost on the API port", async () => {
      const res = await send(
        postTo(API, { headers: { Origin: "http://localhost:3777" } }),
      );
      expect(res.status).toBe(200);
    });

    it("allows a POST from the Vite dev origin (localhost and 127.0.0.1)", async () => {
      const fromLocalhost = await send(
        postTo(API, {
          headers: {
            Origin: "http://localhost:5173",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      const fromLoopback = await send(
        postTo(API, {
          headers: {
            Origin: "http://127.0.0.1:5173",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(fromLocalhost.status).toBe(200);
      expect(fromLoopback.status).toBe(200);
    });

    it("allows a POST with no Origin header (curl, server-to-server)", async () => {
      const res = await send(
        postTo(API, {
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("uses the configured port, not the PORT env var", async () => {
      const original = process.env.PORT;
      process.env.PORT = "4444";
      try {
        const res = await send(
          postTo("http://127.0.0.1:3900/api/health", {
            headers: { Origin: "http://127.0.0.1:3900" },
          }),
          { port: 3900, listenHost: "127.0.0.1" },
        );
        expect(res.status).toBe(200);
        const rejected = await send(
          postTo("http://127.0.0.1:3900/api/health", {
            headers: { Origin: "http://127.0.0.1:4444" },
          }),
          { port: 3900, listenHost: "127.0.0.1" },
        );
        expect(rejected.status).toBe(403);
      } finally {
        if (original === undefined) delete process.env.PORT;
        else process.env.PORT = original;
      }
    });
  });

  describe("JSON content type on state-changing bodies", () => {
    it("rejects a text/plain POST body with 415", async () => {
      const res = await send(
        postTo(API, {
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(415);
    });

    it("rejects a form-encoded PUT body with 415", async () => {
      const res = await send(
        postTo(API, {
          method: "PUT",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "a=1",
        }),
      );
      expect(res.status).toBe(415);
    });

    it("accepts application/json with a charset parameter", async () => {
      const res = await send(
        postTo(API, {
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });

    it("allows a POST with no body without a Content-Type", async () => {
      const res = await send(postTo(API, {}));
      expect(res.status).toBe(200);
    });

    it("checks Origin before Content-Type", async () => {
      const res = await send(
        postTo(API, {
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "text/plain",
          },
          body: "{}",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("does not apply the content-type rule to GET", async () => {
      const res = await send(
        postTo(API, {
          method: "GET",
          headers: { "Content-Type": "text/plain" },
          body: "x",
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("Host header (DNS rebinding)", () => {
    it("rejects a GET whose Host is a rebinding name with 403", async () => {
      const res = await send(
        new Request("http://evil.com:3777/api/health", {
          headers: { Host: "evil.com:3777" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects a GET whose URL host is not loopback with 403", async () => {
      const res = await send(new Request("http://evil.com:3777/api/health"));
      expect(res.status).toBe(403);
    });

    it("allows a GET on localhost and 127.0.0.1 with the API port", async () => {
      const local = await send(
        new Request("http://localhost:3777/api/health", {
          headers: { Host: "localhost:3777" },
        }),
      );
      const loopback = await send(
        new Request("http://127.0.0.1:3777/api/health", {
          headers: { Host: "127.0.0.1:3777" },
        }),
      );
      expect(local.status).toBe(200);
      expect(loopback.status).toBe(200);
    });

    it("rejects a loopback Host on the wrong port with 403", async () => {
      const res = await send(
        new Request("http://127.0.0.1:9999/api/health", {
          headers: { Host: "127.0.0.1:9999" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects a non-loopback Host when X_FACTORY_HOST is not set", async () => {
      const res = await send(
        new Request("http://192.168.1.5:3777/api/health", {
          headers: { Host: "192.168.1.5:3777" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("accepts the configured X_FACTORY_HOST as Host", async () => {
      const res = await send(
        new Request("http://192.168.1.5:3777/api/health", {
          headers: { Host: "192.168.1.5:3777" },
        }),
        { port: 3777, listenHost: "192.168.1.5" },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("exact-host rule for X_FACTORY_HOST", () => {
    it("a wildcard listen host does not admit LAN clients", async () => {
      const res = await send(
        new Request("http://192.168.1.5:3777/api/health", {
          headers: { Host: "192.168.1.5:3777" },
        }),
        { port: 3777, listenHost: "0.0.0.0" },
      );
      expect(res.status).toBe(403);
    });

    it("a LAN client is admitted only when X_FACTORY_HOST is its exact address", async () => {
      const otherHost = await send(
        new Request("http://192.168.1.6:3777/api/health", {
          headers: { Host: "192.168.1.6:3777" },
        }),
        { port: 3777, listenHost: "192.168.1.5" },
      );
      expect(otherHost.status).toBe(403);
    });

    it("accepts an IPv6 X_FACTORY_HOST as a bracketed Host", async () => {
      const res = await send(
        new Request("http://[::1]:3777/api/health", {
          headers: { Host: "[::1]:3777" },
        }),
        { port: 3777, listenHost: "::1" },
      );
      expect(res.status).toBe(200);
    });

    it("accepts an IPv6 X_FACTORY_HOST as a bracketed Origin", async () => {
      const res = await send(
        postTo("http://[::1]:3777/api/health", {
          headers: {
            Origin: "http://[::1]:3777",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
        { port: 3777, listenHost: "::1" },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("Host normalisation", () => {
    it("allows an uppercase loopback Host", async () => {
      const res = await send(
        new Request("http://LOCALHOST:3777/api/health", {
          headers: { Host: "LOCALHOST:3777" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("rejects a loopback Host with a trailing dot", async () => {
      const res = await send(
        new Request("http://localhost.:3777/api/health", {
          headers: { Host: "localhost.:3777" },
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects [::1] unless it is the configured X_FACTORY_HOST", async () => {
      const res = await send(
        new Request("http://[::1]:3777/api/health", {
          headers: { Host: "[::1]:3777" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("configured X_FACTORY_HOST as the server's own origin", () => {
    it("accepts a POST whose Origin is the configured host", async () => {
      const res = await send(
        postTo("http://192.168.1.5:3777/api/health", {
          headers: {
            Origin: "http://192.168.1.5:3777",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
        { port: 3777, listenHost: "192.168.1.5" },
      );
      expect(res.status).toBe(200);
    });

    it("rejects that same Origin when X_FACTORY_HOST is not set", async () => {
      const res = await send(
        postTo("http://192.168.1.5:3777/api/health", {
          headers: { Origin: "http://192.168.1.5:3777" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("safe methods", () => {
    it("GET from a foreign Origin is unaffected", async () => {
      const res = await send(
        new Request(API, { headers: { Origin: "https://evil.example" } }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("listen host", () => {
    const original = process.env.X_FACTORY_HOST;

    afterEach(() => {
      if (original === undefined) delete process.env.X_FACTORY_HOST;
      else process.env.X_FACTORY_HOST = original;
    });

    it("defaults to the loopback address", () => {
      delete process.env.X_FACTORY_HOST;
      expect(resolveListenHost()).toBe("127.0.0.1");
    });

    it("honours an explicit X_FACTORY_HOST override", () => {
      process.env.X_FACTORY_HOST = "0.0.0.0";
      expect(resolveListenHost()).toBe("0.0.0.0");
    });
  });
});
