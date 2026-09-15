// test/http.test.ts — Unit tests for HTTP utilities and static asset serving.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEventStreamResponse,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../src/http/responses.js";
import { serveStatic } from "../src/http/static.js";
import type { RunEvent } from "../src/types.js";

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

  it("errorResponse formats error object with status code", async () => {
    const res = errorResponse("Something went wrong", 400);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.deepEqual(data, { error: "Something went wrong" });
  });

  it("parseJsonBody parses valid JSON and returns null for invalid JSON", async () => {
    const validReq = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
      headers: { "Content-Type": "application/json" },
    });
    const parsedValid = await parseJsonBody(validReq);
    assert.deepEqual(parsedValid, { key: "value" });

    const invalidReq = new Request("http://localhost/api", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    const parsedInvalid = await parseJsonBody(invalidReq);
    assert.equal(parsedInvalid, null);
  });

  it("createEventStreamResponse streams initial events", async () => {
    const events: RunEvent[] = [
      { type: "info", text: "Test event", timestamp: 123456 },
    ];
    const res = createEventStreamResponse(events, () => () => {});
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");

    const reader = res.body?.getReader();
    assert.ok(reader);
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    const text = new TextDecoder().decode(chunk.value);
    assert.ok(text.includes(`"text":"Test event"`));
    await reader.cancel();
  });
});

describe("Static Asset Serving", () => {
  it("serves index.html on root path /", async () => {
    const res = await serveStatic("/", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/html"));
  });

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
    const res = await serveStatic("/fonts/SFPro-Regular.woff2", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "font/woff2");
  });

  it("serves favicon.svg with image/svg+xml content type", async () => {
    const res = await serveStatic("/favicon.svg", PUBLIC_DIR);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/svg+xml");
  });
});
