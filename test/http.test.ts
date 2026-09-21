// test/http.test.ts — Unit tests for HTTP utilities and static asset serving.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  errorResponse,
  formatSSEMessage,
  jsonResponse,
  parseJsonBody,
} from "../src/http/responses.js";
import { serveStatic } from "../src/http/static.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

describe("HTTP Response Helpers", () => {
  it("jsonResponse formats JSON body and sets Content-Type header", async () => {
    const res = jsonResponse({ hello: "world" }, 201);
    assert.equal(res.status, 201);
    assert.equal(
      res.headers.get("Content-Type"),
      "application/json; charset=utf-8",
    );
    const data = await res.json();
    assert.deepEqual(data, { hello: "world" });
  });

  it("errorResponse formats error object with default 400", async () => {
    const res = errorResponse("Something went wrong");
    assert.equal(res.status, 400);
    const data = (await res.json()) as { error: string };
    assert.equal(data.error, "Something went wrong");
  });

  it("parseJsonBody parses valid JSON and returns null on malformed body", async () => {
    const validReq = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
      headers: { "Content-Type": "application/json" },
    });
    const parsedValid = await parseJsonBody(validReq);
    assert.deepEqual(parsedValid, { key: "value" });

    const invalidReq = new Request("http://localhost", {
      method: "POST",
      body: "{ not valid json",
      headers: { "Content-Type": "application/json" },
    });
    const parsedInvalid = await parseJsonBody(invalidReq);
    assert.equal(parsedInvalid, null);
  });

  it("formatSSEMessage formats wire SSE message with sequence id and payload", () => {
    const sse = formatSSEMessage({
      id: 1,
      type: "info",
      payload: { text: "Test event" },
      timestamp: "2026-09-21T00:00:00.000Z",
    });
    assert.ok(sse.includes("id: 1\n"));
    assert.ok(sse.includes(`"text":"Test event"`));
    assert.ok(!sse.includes("event:"));
  });
});

describe("Static Asset Serving", () => {
  it("serves css file with text/css content type", async () => {
    const res = await serveStatic("/styles.css", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/css"));
  });

  it("blocks directory traversal with 403 Forbidden", async () => {
    const res = await serveStatic("../../package.json", PUBLIC_DIR);
    assert.equal(res.status, 403);
  });

  it("returns 404 for non-existent file", async () => {
    const res = await serveStatic("/does-not-exist.xyz", PUBLIC_DIR);
    assert.equal(res.status, 404);
  });

  it("serves woff2 font with font/woff2 content type", async () => {
    const res = await serveStatic("/fonts/Inter-Regular.woff2", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "font/woff2");
  });

  it("serves favicon.svg with image/svg+xml content type", async () => {
    const res = await serveStatic("/favicon.svg", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/svg+xml");
  });

  it("serves reference.html on /reference route", async () => {
    const res = await serveStatic("/reference", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/html"));
  });

  it("serves unknown extensions with application/octet-stream fallback", async () => {
    // Create a temporary file with custom extension
    const tempPath = path.join(PUBLIC_DIR, "test-binary.xyz");
    await Bun.write(tempPath, "custom binary content");
    try {
      const res = await serveStatic("/test-binary.xyz", PUBLIC_DIR);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Content-Type"), "application/octet-stream");
    } finally {
      const f = Bun.file(tempPath);
      if (await f.exists()) {
        const unlink = (await import("node:fs/promises")).unlink;
        await unlink(tempPath);
      }
    }
  });
});
