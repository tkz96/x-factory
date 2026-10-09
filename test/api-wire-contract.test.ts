// test/api-wire-contract.test.ts — The shared request/response wire contract (#182).
//
// Seam: HTTP API (`handleApi` with an in-memory SQLite database). Each route's
// body is asserted with literal expectations, and the client's method
// signatures are pinned to the shared types at compile time, so changing a
// response shape on either side fails the typecheck or this test.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import type { api } from "../src/frontend/lib/api-client.js";
import { handleApi } from "../src/http/routes.js";
import { getSettingsPath } from "../src/paths.js";
import type {
  AbandonRunRequest,
  AbandonRunResponse,
  ChatWithRunRequest,
  ChatWithRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  DiagnosticsResponse,
  DocDetailResponse,
  DocsCatalogResponse,
  DocsSearchResponse,
  PrRunRequest,
  PrRunResponse,
  ReadinessResponse,
  ResumeRunRequest,
  ResumeRunResponse,
  SettingsUpdateRequest,
  StopRunResponse,
  TransitionRunRequest,
  TransitionRunResponse,
  WorkbenchSettings,
} from "../src/shared/types.js";

// The client-only duplicate declarations that must be gone from the API
// client (settings, readiness, diagnostics, docs — #182 AC3).
const CLIENT_TYPE_NAMES = [
  "SettingsData",
  "ReadinessData",
  "DiagnosticsData",
  "DocsCatalogResponse",
  "DocsSearchResponse",
  "DocDetailResponse",
  "DocSearchResult",
  "DocSearchMatch",
  "DocCategory",
  "DocItem",
] as const;

// The wire types the shared module must declare once.
const SHARED_WIRE_TYPE_NAMES = [
  "WorkbenchSettings",
  "SettingsUpdateRequest",
  "ReadinessResponse",
  "ReadinessCheck",
  "DiagnosticsResponse",
  "RunOkResponse",
  "CreateRunRequest",
  "CreateRunResponse",
  "ResumeRunRequest",
  "ResumeRunResponse",
  "AbandonRunRequest",
  "AbandonRunResponse",
  "ChatWithRunRequest",
  "ChatWithRunResponse",
  "RunTransitionAction",
  "TransitionRunRequest",
  "TransitionRunResponse",
  "StopRunResponse",
  "PrRunRequest",
  "PrRunResponse",
  "DocsCatalogResponse",
  "DocsSearchResponse",
  "DocDetailResponse",
  "DocSearchResult",
  "DocSearchMatch",
  "DocCategory",
  "DocItem",
] as const;

// One in-memory database and its repository bundle serve every request in
// this file, the way the composition root passes them down (#169).
const db = createDatabase({ path: ":memory:" });
runMigrations(db);
const repos = createRepositories(db);

afterAll(() => {
  db.close();
});

describe("Shared wire contract (#182, HTTP API seam)", () => {
  it("POST /api/runs/:id/stop returns the run it stopped", async () => {
    {
      const runRepo = new RunRepository(db);
      const runId = `wire-stop-${Date.now()}`;
      runRepo.create({
        id: runId,
        projectId: "wire-proj",
        projectName: "Wire Project",
        ticket: { id: "W-1", title: "Wire Stop", acceptanceCriteria: [] },
        plan: "Plan",
        branch: "factory/w-1",
        status: "executing",
        artifactsDir: `/tmp/artifacts-${runId}`,
        worktreePath: `/tmp/worktrees-${runId}`,
      });

      const req = new Request(`http://localhost:3777/api/runs/${runId}/stop`, {
        method: "POST",
      });
      const res = await handleApi(req, new URL(req.url), { repos });
      expect(res.status).toBe(200);

      const body = (await res.json()) as StopRunResponse;
      expect(body.ok).toBe(true);
      expect(body.run.id).toBe(runId);
      expect(body.run.status).toBe("stopped");
      expect(body.run.project).toEqual({
        id: "wire-proj",
        name: "Wire Project",
      });
      expect(body.run.branch).toBe("factory/w-1");
    }
  });

  it("POST /api/settings saves {provider, model} and the settings file stays valid", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "xf-wire-settings-"));
    const previousDataDir = process.env.X_FACTORY_DATA_DIR;
    process.env.X_FACTORY_DATA_DIR = dataDir;
    try {
      const payload: SettingsUpdateRequest = {
        models: {
          sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
          sessionB: { provider: "openai", model: "gpt-4o-mini" },
        },
      };

      const postReq = new Request("http://localhost:3777/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const postRes = await handleApi(postReq, new URL(postReq.url), { repos });
      expect(postRes.status).toBe(200);
      const saved = (await postRes.json()) as WorkbenchSettings;
      expect(saved).toEqual({ theme: "dark", models: payload.models });

      // The on-disk file parses as JSON and holds exactly {provider, model}
      // per session — never a string scalar, never spread characters.
      const raw = await readFile(getSettingsPath(), "utf-8");
      const onDisk = JSON.parse(raw) as WorkbenchSettings;
      expect(onDisk.models).toEqual({
        sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
        sessionB: { provider: "openai", model: "gpt-4o-mini" },
      });

      const getReq = new Request("http://localhost:3777/api/settings");
      const getRes = await handleApi(getReq, new URL(getReq.url), { repos });
      expect(getRes.status).toBe(200);
      const loaded = (await getRes.json()) as WorkbenchSettings;
      expect(loaded.models).toEqual(payload.models);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.X_FACTORY_DATA_DIR;
      } else {
        process.env.X_FACTORY_DATA_DIR = previousDataDir;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("pins the API client's method signatures to the shared wire types", () => {
    // Compile-time only: each Assert fails `bun run typecheck` when a client
    // method stops naming the shared type (a response shape changed on one
    // side of the wire). The runtime assertion keeps the block a real test.
    type Assert<T extends true> = T;
    type Equals<A, B> =
      (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
        ? true
        : false;

    const checks: [
      Assert<
        Equals<ReturnType<typeof api.getSettings>, Promise<WorkbenchSettings>>
      >,
      Assert<
        Equals<ReturnType<typeof api.saveSettings>, Promise<WorkbenchSettings>>
      >,
      Assert<
        Equals<Parameters<typeof api.saveSettings>[0], SettingsUpdateRequest>
      >,
      Assert<
        Equals<ReturnType<typeof api.getReadiness>, Promise<ReadinessResponse>>
      >,
      Assert<
        Equals<
          ReturnType<typeof api.getDiagnostics>,
          Promise<DiagnosticsResponse>
        >
      >,
      Assert<
        Equals<
          ReturnType<typeof api.getDocsCatalog>,
          Promise<DocsCatalogResponse>
        >
      >,
      Assert<
        Equals<ReturnType<typeof api.searchDocs>, Promise<DocsSearchResponse>>
      >,
      Assert<Equals<ReturnType<typeof api.getDoc>, Promise<DocDetailResponse>>>,
      Assert<Equals<ReturnType<typeof api.stopRun>, Promise<StopRunResponse>>>,
      Assert<Equals<Parameters<typeof api.createRun>[0], CreateRunRequest>>,
      Assert<
        Equals<ReturnType<typeof api.createRun>, Promise<CreateRunResponse>>
      >,
      Assert<
        Equals<ReturnType<typeof api.resumeRun>, Promise<ResumeRunResponse>>
      >,
      // The bodyless routes take exactly the run id — no request payload.
      Assert<Equals<Parameters<typeof api.resumeRun>, [runId: string]>>,
      Assert<Equals<ResumeRunRequest, Record<string, never>>>,
      Assert<
        Equals<ReturnType<typeof api.abandonRun>, Promise<AbandonRunResponse>>
      >,
      Assert<
        Equals<
          Parameters<typeof api.abandonRun>[1],
          AbandonRunRequest["reason"]
        >
      >,
      Assert<
        Equals<ReturnType<typeof api.chatWithRun>, Promise<ChatWithRunResponse>>
      >,
      Assert<
        Equals<
          Parameters<typeof api.chatWithRun>[1],
          ChatWithRunRequest["message"]
        >
      >,
      Assert<
        Equals<
          ReturnType<typeof api.transitionRun>,
          Promise<TransitionRunResponse>
        >
      >,
      Assert<
        Equals<
          Parameters<typeof api.transitionRun>[1],
          TransitionRunRequest["action"]
        >
      >,
      Assert<
        Equals<
          Parameters<typeof api.transitionRun>[2],
          TransitionRunRequest["payload"]
        >
      >,
      Assert<Equals<ReturnType<typeof api.prRun>, Promise<PrRunResponse>>>,
      Assert<Equals<Parameters<typeof api.prRun>, [runId: string]>>,
      Assert<Equals<PrRunRequest, Record<string, never>>>,
    ] = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    expect(checks.every(Boolean)).toBe(true);
  });

  it("the API client declares none of the wire types itself — they come from the shared module", async () => {
    const clientSource = await Bun.file(
      path.join(import.meta.dir, "../src/frontend/lib/api-client.ts"),
    ).text();
    for (const name of CLIENT_TYPE_NAMES) {
      expect(clientSource).not.toContain(`interface ${name}`);
    }
    // The client is annotated against the shared declarations: the import
    // block from the shared module names each wire type.
    const sharedImport =
      clientSource.match(
        /import type \{[\s\S]*?\} from "\.\.\/\.\.\/shared\/types\.js";/,
      )?.[0] ?? "";
    for (const name of [
      "WorkbenchSettings",
      "SettingsUpdateRequest",
      "ReadinessResponse",
      "DiagnosticsResponse",
      "CreateRunRequest",
      "CreateRunResponse",
      "ResumeRunResponse",
      "AbandonRunRequest",
      "AbandonRunResponse",
      "ChatWithRunRequest",
      "ChatWithRunResponse",
      "RunTransitionAction",
      "TransitionRunRequest",
      "TransitionRunResponse",
      "StopRunResponse",
      "PrRunResponse",
      "DocsCatalogResponse",
      "DocsSearchResponse",
      "DocDetailResponse",
    ]) {
      expect(sharedImport).toContain(name);
    }

    // …and the shared module is where those declarations live.
    const sharedSource = await Bun.file(
      path.join(import.meta.dir, "../src/shared/types.ts"),
    ).text();
    for (const name of SHARED_WIRE_TYPE_NAMES) {
      expect(sharedSource).toContain(name);
    }
  });

  it("the runs controller answers each run route with jsonResponse<SharedType>", async () => {
    // The controller-side half of the guarantee: every run route names its
    // shared response type at the jsonResponse call, so a controller-side
    // shape change fails `bun run typecheck` rather than shipping.
    const controllerSource = await Bun.file(
      path.join(import.meta.dir, "../src/http/runs-controller.ts"),
    ).text();
    for (const name of [
      "CreateRunResponse",
      "ResumeRunResponse",
      "AbandonRunResponse",
      "ChatWithRunResponse",
      "TransitionRunResponse",
      "StopRunResponse",
      "PrRunResponse",
    ]) {
      expect(controllerSource).toContain(`jsonResponse<${name}>`);
    }
  });
});
