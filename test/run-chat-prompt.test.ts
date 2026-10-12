// test/run-chat-prompt.test.ts — In run chat the Builder answers the operator as
// the builder of the change. A live end-to-end test found it answering a question
// and then quizzing the operator about "your plan" as if the operator were the one
// building it: the system prompt told the model to grill the user.
//
// The seam is chatWithRun against a local OpenAI-compatible endpoint, so the test
// reads the exact messages the model receives.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "bun";
import type { Repositories } from "../src/composition-root.js";
import {
  createModelConnection,
  updateModelConnection,
} from "../src/model-connections.js";
import { chatWithRun } from "../src/runs.js";
import { saveSettings } from "../src/settings.js";
import { createTestRepositories } from "./helpers/composition.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";

interface SentMessage {
  role: string;
  content: unknown;
}

let repos: Repositories;
let dataDir: string;
let savedDataDir: string | undefined;
let server: Server<undefined>;
let sent: SentMessage[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as {
        model: string;
        messages: SentMessage[];
      };
      sent = body.messages;
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      return new Response(
        `${chunk({ role: "assistant", content: "src/a.ts and test/a.test.ts." }, null)}${chunk({}, "stop")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
});

afterAll(() => server.stop(true));

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-run-chat-prompt-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
  sent = [];
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

async function builderOnLocalEndpoint(): Promise<void> {
  const connection = await createModelConnection({
    name: "Local gateway",
    apiType: "openai-compatible",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    apiKey: "good-key",
  });
  await updateModelConnection(connection.id, {
    verifiedAt: new Date().toISOString(),
  });
  await saveSettings({
    roles: {
      builder: { connectionId: connection.id, modelId: "vendor/chat-model" },
    },
  });
}

function seedRun(id: string) {
  repos.runs.create({
    id,
    projectId: "proj-chat-prompt",
    projectName: "Chat Prompt",
    ticket: { id: "T-1", title: "Add subtract(a, b)", acceptanceCriteria: [] },
    plan: "1. Do it",
    branch: "main",
    status: "queued",
    artifactsDir: dataDir,
    worktreePath: dataDir,
  });
  forceRunStatus(repos.db, id, "awaiting_understanding_approval");
}

describe("run chat speaks as the Builder to the operator", () => {
  it("frames the Builder as the one doing the work, answering the operator", async () => {
    await builderOnLocalEndpoint();
    seedRun("run-chat-prompt");

    const result = await chatWithRun(
      repos,
      "run-chat-prompt",
      "Which two files will you change?",
    );
    expect(result.ok).toBe(true);

    const system = sent.find((m) => m.role === "system");
    const prompt = String(system?.content ?? "");
    // The Builder is the one building the change, and the operator reviews it.
    expect(prompt).toContain("You are the Builder");
    expect(prompt).toMatch(/operator/);
    expect(prompt).toMatch(/answer the operator's question/i);
    expect(prompt).toMatch(/do not quiz the operator/i);
    // Nothing tells the model to interrogate the person asking.
    expect(prompt).not.toMatch(/grill|relentless|question their plan/i);
    // The phase the run is in is still named.
    expect(prompt).toContain("understanding");

    const lastUser = sent.filter((m) => m.role === "user").at(-1);
    expect(lastUser?.content).toBe("Which two files will you change?");
  });
});
