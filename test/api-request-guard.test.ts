// test/api-request-guard.test.ts — Local-only API boundary: cross-origin and content-type guards at the handleApi seam.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { resolveListenHost } from "../src/http/request-guard.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

const API = "http://127.0.0.1:3777/api/health";

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

async function send(req: Request): Promise<Response> {
  return handleApi(req, new URL(req.url));
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
  });

  describe("JSON content type on bodies", () => {
    it("rejects a text/plain body with 415", async () => {
      const res = await send(
        postTo(API, {
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(415);
    });

    it("rejects a form-encoded body with 415", async () => {
      const res = await send(
        postTo(API, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
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
  });

  describe("safe methods", () => {
    it("GET from a foreign origin is unaffected", async () => {
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
