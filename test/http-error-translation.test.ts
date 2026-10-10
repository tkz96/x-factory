import { beforeEach, describe, expect, it } from "bun:test";
import type { Repositories } from "../src/composition-root.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../src/errors.js";
import {
  catchHttpErrors,
  HttpError,
  translateDomainErrorToHttpResponse,
} from "../src/http/responses.js";
import { createTestRepositories } from "./helpers/composition.js";
import { dispatchHttp } from "./helpers/http-dispatch.js";

let repos: Repositories;

beforeEach(() => {
  repos = createTestRepositories();
});

describe("HTTP Layer Error Translation", () => {
  it("translates neutral NotFoundError into standard 404 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new NotFoundError("Entity missing");
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Entity missing" });
  });

  it("translates neutral ValidationError into standard 400 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ValidationError("Parameter invalid");
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Parameter invalid" });
  });

  it("translates neutral ConflictError into standard 409 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ConflictError("Concurrent modification conflict");
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Concurrent modification conflict" });
  });

  it("translates presentation HttpError to specified status code", async () => {
    const res = await catchHttpErrors(async () => {
      throw new HttpError(422, "Unprocessable payload");
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: "Unprocessable payload" });
  });

  it("translates unhandled generic Error to a generic 500 that never quotes the message", async () => {
    const res = await catchHttpErrors(async () => {
      throw new Error("Unexpected internal failure");
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    // #163 B2: an unexpected error's text can quote SQL, a filesystem path or a
    // secret, so the client only ever sees the generic envelope.
    expect(body).toEqual({ error: "Internal error", code: "INTERNAL" });
  });

  it("logs an unexpected handler error's detail server-side and answers the generic 500", async () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      // The leaked detail is exactly the kind of text the client must never see:
      // it quotes SQL that names a column holding a secret.
      const throwingRepos = {
        ...repos,
        runs: {
          ...repos.runs,
          list(): never {
            throw new Error("SQLITE_ERROR: no such column: secret_token");
          },
        },
      } as unknown as Repositories;

      const res = await dispatchHttp(
        new Request("http://localhost:3777/api/runs"),
        throwingRepos,
      );

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "Internal error",
        code: "INTERNAL",
      });
    } finally {
      console.error = originalError;
    }

    const journal = logged.join("\n");
    expect(journal).toContain("SQLITE_ERROR: no such column: secret_token");
    expect(journal).toContain("/api/runs");
  });

  it("translateDomainErrorToHttpResponse directly converts domain errors", async () => {
    const notFoundRes = translateDomainErrorToHttpResponse(
      new NotFoundError("Not here"),
    );
    expect(notFoundRes).not.toBeNull();
    expect(notFoundRes?.status).toBe(404);
    expect(await notFoundRes?.json()).toEqual({ error: "Not here" });

    const validationRes = translateDomainErrorToHttpResponse(
      new ValidationError("Bad argument"),
    );
    expect(validationRes).not.toBeNull();
    expect(validationRes?.status).toBe(400);
    expect(await validationRes?.json()).toEqual({ error: "Bad argument" });

    const conflictRes = translateDomainErrorToHttpResponse(
      new ConflictError("Revision mismatch"),
    );
    expect(conflictRes).not.toBeNull();
    expect(conflictRes?.status).toBe(409);
    expect(await conflictRes?.json()).toEqual({ error: "Revision mismatch" });
  });

  it("runs controller translates neutral NotFoundError to 404 response on chat", async () => {
    const req = new Request(
      "http://localhost:3777/api/runs/nonexistent-run/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello world" }),
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("projects controller translates neutral NotFoundError to 404 response on delete", async () => {
    const req = new Request(
      "http://localhost:3777/api/projects/nonexistent-proj",
      {
        method: "DELETE",
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: 'Project "nonexistent-proj" not found.' });
  });

  it("projects controller maps a real ValidationError to 400 (git identity, non-existent directory)", async () => {
    // A neutral ValidationError from the readiness/inspection module reaches
    // the boundary through a real trigger: configuring a local git identity for
    // a directory that does not exist. The discover-repositories route that
    // used to cover this mapping is gone with #183.
    const req = new Request(
      "http://localhost:3777/api/projects/configure-git-identity",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "/nonexistent/x-factory-183-directory",
          name: "Ada Lovelace",
          email: "ada@example.com",
          scope: "local",
        }),
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(400);
    const body = (await res?.json()) as { error?: string; code?: string };
    expect(body.code).toBe("DIRECTORY_MISSING");
    expect(body.error).toContain("does not exist");
  });

  it("projects controller no longer claims the flat discovery route (#183)", async () => {
    const req = new Request(
      "http://localhost:3777/api/projects/discover-repositories",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "nonexistent-provider" }),
      },
    );

    const res = await dispatchHttp(req, repos);
    // The duplicate provider route is deleted: the projects controller declines
    // the path, and the canonical POST /api/providers/repositories is the only
    // discovery action. The route table turns the unmatched path into a 404.
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "Endpoint not found." });
  });

  it("runs controller translates neutral NotFoundError to 404 response on stop", async () => {
    const req = new Request(
      "http://localhost:3777/api/runs/nonexistent-run/stop",
      {
        method: "POST",
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("runs controller translates neutral NotFoundError to 404 response on pr", async () => {
    const req = new Request(
      "http://localhost:3777/api/runs/nonexistent-run/pr",
      {
        method: "POST",
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("runs controller translates neutral NotFoundError to 404 response on resume", async () => {
    const req = new Request(
      "http://localhost:3777/api/runs/nonexistent-run/resume",
      {
        method: "POST",
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("runs controller translates neutral NotFoundError to 404 response on abandon", async () => {
    const req = new Request(
      "http://localhost:3777/api/runs/nonexistent-run/abandon",
      {
        method: "POST",
      },
    );

    const res = await dispatchHttp(req, repos);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("runs controller translates ConflictError to 409 response when action conflicts with run state", async () => {
    const runRepo = repos.runs;
    const runId = `conflict-test-run-${Date.now()}`;
    runRepo.create({
      id: runId,
      projectId: "proj-conflict",
      projectName: "Conflict Project",
      ticket: { id: "CONF-1", title: "Conflict Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/conf-1",
      status: "stopped",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    // 1. Attempting PR creation on a stopped run must yield 409
    const prReq = new Request(`http://localhost:3777/api/runs/${runId}/pr`, {
      method: "POST",
    });
    const prRes = await dispatchHttp(prReq, repos);
    expect(prRes).not.toBeNull();
    expect(prRes?.status).toBe(409);
    const prBody = await prRes?.json();
    expect(prBody.error).toBe(
      'Cannot create PR in status "stopped". Run must be in "ready_for_pr".',
    );

    // 2. Attempting resume on a stopped run (not recovery_required) must yield 409
    const resumeReq = new Request(
      `http://localhost:3777/api/runs/${runId}/resume`,
      {
        method: "POST",
      },
    );
    const resumeRes = await dispatchHttp(resumeReq, repos);
    expect(resumeRes).not.toBeNull();
    expect(resumeRes?.status).toBe(409);
    const resumeBody = await resumeRes?.json();
    expect(resumeBody.error).toBe(
      'Cannot resume run in status "stopped". Run must be in "recovery_required".',
    );

    // 3. Attempting abandon on a stopped run (not recovery_required) must yield 409
    const abandonReq = new Request(
      `http://localhost:3777/api/runs/${runId}/abandon`,
      {
        method: "POST",
      },
    );
    const abandonRes = await dispatchHttp(abandonReq, repos);
    expect(abandonRes).not.toBeNull();
    expect(abandonRes?.status).toBe(409);
    const abandonBody = await abandonRes?.json();
    expect(abandonBody.error).toBe(
      'Cannot abandon run in status "stopped". Run must be in "recovery_required".',
    );

    // 4. Attempting stop on a pr_created run must yield 409
    const prCreatedRunId = `pr-created-test-run-${Date.now()}`;
    runRepo.create({
      id: prCreatedRunId,
      projectId: "proj-conflict",
      projectName: "Conflict Project",
      ticket: {
        id: "CONF-2",
        title: "Conflict Test 2",
        acceptanceCriteria: [],
      },
      plan: "Plan",
      branch: "factory/conf-2",
      status: "pr_created",
      artifactsDir: `/tmp/artifacts-${prCreatedRunId}`,
      worktreePath: `/tmp/worktrees-${prCreatedRunId}`,
    });
    const stopReq = new Request(
      `http://localhost:3777/api/runs/${prCreatedRunId}/stop`,
      {
        method: "POST",
      },
    );
    const stopRes = await dispatchHttp(stopReq, repos);
    expect(stopRes).not.toBeNull();
    expect(stopRes?.status).toBe(409);
    const stopBody = await stopRes?.json();
    expect(stopBody.error).toBe('Cannot stop in status "pr_created".');
  });
});
