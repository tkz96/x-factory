// test/verification.test.ts — Deterministic verification pipeline and repair prompt tests.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateProject } from "../src/config.js";
import { execStrict } from "../src/proc.js";
import { buildRepairPrompt } from "../src/prompts.js";
import type { Project, Ticket, VerificationResult } from "../src/types.js";
import { runVerification } from "../src/verification.js";
import { recordBaseline } from "../src/worktree-state.js";

let baseTempDir: string;
let fixtureRepo: string;

beforeAll(async () => {
  baseTempDir = await mkdtemp(path.join(tmpdir(), "xf-verify-test-"));
  fixtureRepo = path.join(baseTempDir, "repo");

  await execStrict("git", ["init", fixtureRepo], { envPolicy: "inherit" });
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });

  await writeFile(path.join(fixtureRepo, "README.md"), "# Verify Fixture\n");
  await execStrict("git", ["add", "-A"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
  await execStrict("git", ["commit", "-m", "Initial commit"], {
    envPolicy: "inherit",
    cwd: fixtureRepo,
  });
});

afterAll(async () => {
  if (baseTempDir) {
    await rm(baseTempDir, { recursive: true, force: true });
  }
});

describe("Deterministic Verification Pipeline", () => {
  const project = validateProject({
    id: "test-app",
    name: "Test App",
    repositoryPath: "/mock",
    defaultBranch: "main",
    testCommand: "echo 'tests passed'",
  });

  it("passes when tests succeed and non-empty diff exists without pollution", async () => {
    const baseline = await recordBaseline(fixtureRepo);

    // Modify a file to create a diff
    await writeFile(
      path.join(fixtureRepo, "feature.ts"),
      "export const x = 42;\n",
    );

    const result = await runVerification(fixtureRepo, project, baseline, 1);
    assert.equal(result.passed, true);
    assert.equal(result.hasPollution, false);
    assert.ok(result.filesChanged.includes("feature.ts"));
    assert.ok(result.summary.includes("Tests passed"));

    // Revert change
    await rm(path.join(fixtureRepo, "feature.ts"));
  });

  it("fails when tests exit non-zero", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(
      path.join(fixtureRepo, "feature.ts"),
      "export const x = 42;\n",
    );

    const failingProject: Project = {
      ...project,
      testCommand: "sh -c 'echo \"syntax error in tests\" >&2; exit 1'",
    };

    const result = await runVerification(
      fixtureRepo,
      failingProject,
      baseline,
      1,
    );
    assert.equal(result.passed, false);
    assert.equal(result.tests.passed, false);
    assert.equal(result.tests.exitCode, 1);
    assert.ok(result.summary.includes("Tests failed"));

    await rm(path.join(fixtureRepo, "feature.ts"));
  });

  it("fails when pollution is detected", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(
      path.join(fixtureRepo, "feature.ts"),
      "export const x = 42;\n",
    );
    await writeFile(
      path.join(fixtureRepo, "debug.log"),
      "temporary debug log\n",
    );

    const result = await runVerification(fixtureRepo, project, baseline, 1);
    assert.equal(result.passed, false);
    assert.equal(result.hasPollution, true);
    assert.ok(result.summary.includes("Pollution detected"));

    await rm(path.join(fixtureRepo, "feature.ts"));
    await rm(path.join(fixtureRepo, "debug.log"));
  });

  it("fails when no implementation changes exist (empty diff)", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    const result = await runVerification(fixtureRepo, project, baseline, 1);
    assert.equal(result.passed, false);
    assert.ok(result.summary.includes("No implementation changes detected"));
  });

  it("fails the no-change gate when only scaffold files changed", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    await mkdir(path.join(fixtureRepo, ".agent"), { recursive: true });
    await writeFile(path.join(fixtureRepo, ".agent", "tasks.md"), "- [x] t\n");
    await writeFile(path.join(fixtureRepo, "ralph.sh"), "#!/bin/sh\n");

    const result = await runVerification(fixtureRepo, project, baseline, 1);

    assert.equal(result.passed, false);
    assert.deepEqual(result.filesChanged, []);
    assert.ok(result.summary.includes("No implementation changes detected"));

    await rm(path.join(fixtureRepo, ".agent"), { recursive: true });
    await rm(path.join(fixtureRepo, "ralph.sh"));
  });

  it("reports implementation files exactly and leaves scaffold out of them", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(path.join(fixtureRepo, "README.md"), "# Changed\n");
    await writeFile(path.join(fixtureRepo, "ralph.sh"), "#!/bin/sh\n");

    const result = await runVerification(fixtureRepo, project, baseline, 1);

    assert.equal(result.passed, true);
    assert.deepEqual(result.filesChanged, ["README.md"]);

    await execStrict("git", ["checkout", "--", "README.md"], {
      envPolicy: "inherit",
      cwd: fixtureRepo,
    });
    await rm(path.join(fixtureRepo, "ralph.sh"));
  });

  it("diffs exactly the files in filesChanged, including new untracked files", async () => {
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(path.join(fixtureRepo, "README.md"), "# Changed\n");
    await writeFile(
      path.join(fixtureRepo, "added.ts"),
      "export const a = 1;\n",
    );
    await writeFile(path.join(fixtureRepo, "ralph.sh"), "#!/bin/sh\n");

    const result = await runVerification(fixtureRepo, project, baseline, 1);

    assert.deepEqual([...result.filesChanged].sort(), [
      "README.md",
      "added.ts",
    ]);
    assert.ok(result.diff.includes("diff --git a/README.md b/README.md"));
    assert.ok(result.diff.includes("diff --git a/added.ts b/added.ts"));
    assert.ok(result.diff.includes("+export const a = 1;"));
    assert.ok(!result.diff.includes("ralph.sh"));

    await execStrict("git", ["checkout", "--", "README.md"], {
      envPolicy: "inherit",
      cwd: fixtureRepo,
    });
    await rm(path.join(fixtureRepo, "added.ts"));
    await rm(path.join(fixtureRepo, "ralph.sh"));
  });

  it("fails when a tracked .env is modified", async () => {
    await writeFile(path.join(fixtureRepo, ".env"), "TOKEN=committed\n");
    await execStrict("git", ["add", ".env"], {
      envPolicy: "inherit",
      cwd: fixtureRepo,
    });
    await execStrict("git", ["commit", "-m", "Track .env"], {
      envPolicy: "inherit",
      cwd: fixtureRepo,
    });
    const baseline = await recordBaseline(fixtureRepo);
    await writeFile(path.join(fixtureRepo, "feature.ts"), "export {};\n");
    await writeFile(path.join(fixtureRepo, ".env"), "TOKEN=leaked\n");

    const result = await runVerification(fixtureRepo, project, baseline, 1);

    assert.equal(result.passed, false);
    assert.equal(result.hasPollution, true);
    assert.ok(result.pollutionDetails?.some((d) => d.includes('".env"')));

    await rm(path.join(fixtureRepo, "feature.ts"));
    await execStrict("git", ["checkout", "--", ".env"], {
      envPolicy: "inherit",
      cwd: fixtureRepo,
    });
  });
});

describe("buildRepairPrompt", () => {
  it("formats structured repair prompt with failure details and criteria", () => {
    const ticket: Ticket = {
      id: "PROJ-101",
      title: "Fix auth token expiry",
      acceptanceCriteria: [
        "Tokens must expire after 1 hour",
        "Return 401 when token expired",
      ],
    };

    const mockVerification: VerificationResult = {
      passed: false,
      repairAttempt: 1,
      tests: {
        command: "bun test",
        exitCode: 1,
        stdout: "",
        stderr: "FAIL: token expiry test expected 401 but got 200",
        passed: false,
        durationMs: 120,
      },
      diff: "- oldTokenExp()\n+ newTokenExp()",
      filesChanged: ["src/auth.ts"],
      hasPollution: false,
      summary: "Tests failed (exit 1)",
    };

    const prompt = buildRepairPrompt(
      ticket,
      "Update auth.ts logic",
      mockVerification,
      1,
    );
    assert.ok(
      prompt.includes(
        "Deterministic verification checks failed on attempt 1 of 3",
      ),
    );
    assert.ok(prompt.includes("Fix ONLY the issues required"));
    assert.ok(
      prompt.includes("FAIL: token expiry test expected 401 but got 200"),
    );
    assert.ok(prompt.includes("Tokens must expire after 1 hour"));
    assert.ok(prompt.includes("src/auth.ts"));
  });
});
