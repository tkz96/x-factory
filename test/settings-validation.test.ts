// test/settings-validation.test.ts — POST /api/settings validates its body at
// the HTTP boundary (#163 B4): a malformed value is a 400 with field details,
// never a 200 with the field silently ignored.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiContext } from "../src/composition-root.js";
import { handleApi } from "../src/http/routes.js";
import { createTestRepositories } from "./helpers/composition.js";

let dataDir: string;
let repos: ApiContext["repos"];
let previousDataDir: string | undefined;

function postSettings(body: unknown): Promise<Response> {
  const req = new Request("http://localhost:3777/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleApi(req, new URL(req.url), { repos });
}

beforeEach(async () => {
  previousDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-settings-validation-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/settings validation (#163 B4)", () => {
  test("rejects a scalar session model with 400 and field details", async () => {
    const res = await postSettings({
      models: { sessionA: "claude-3-7-sonnet" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: unknown[] };
    expect(body.error).toBeDefined();
    expect(Array.isArray(body.details)).toBe(true);
  });

  test("accepts a well-formed settings body", async () => {
    const res = await postSettings({
      theme: "light",
      models: {
        sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
        sessionB: { provider: "openai", model: "gpt-4o-mini" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: string;
      models: { sessionA: { model: string } };
    };
    expect(body.theme).toBe("light");
    expect(body.models.sessionA.model).toBe("claude-3-7-sonnet");
  });
});
