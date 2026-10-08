// test/worktree-state.test.ts — Worktree change detection against the recorded baseline, on real temp git repos.

import { afterEach, beforeEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execStrict } from "../src/proc.js";
import {
  loadRecordedBaseline,
  readWorktreeState,
  recordBaseline,
  saveRecordedBaseline,
} from "../src/worktree-state.js";

let repo: string;

async function write(relPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(repo, relPath)), { recursive: true });
  await writeFile(path.join(repo, relPath), content);
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "xf-worktree-state-"));
  await execStrict("git", ["init", "--initial-branch=main", repo]);
  await execStrict("git", ["config", "user.email", "test@xfactory.dev"], {
    cwd: repo,
  });
  await execStrict("git", ["config", "user.name", "X-Factory Test"], {
    cwd: repo,
  });
  await write("README.md", "# Fixture\n");
  await write("src/app.ts", "export const app = 1;\n");
  await write(".env", "TOKEN=committed\n");
  await write(".gitignore", "node_modules/\n");
  await write(".github/workflows/ci.yml", "name: ci\n");
  await execStrict("git", ["add", "-A"], { cwd: repo });
  await execStrict("git", ["commit", "-m", "Initial commit"], { cwd: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function pathsOf(
  changes: { path: string; kind: string }[],
  kind?: string,
): string[] {
  return changes
    .filter((c) => kind === undefined || c.kind === kind)
    .map((c) => c.path)
    .sort();
}

describe("readWorktreeState", () => {
  it("reports a modified tracked file with its exact path", async () => {
    const baseline = await recordBaseline(repo);
    await write("src/app.ts", "export const app = 2;\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes), ["src/app.ts"]);
  });

  it("reports an untracked new file, including a path with spaces", async () => {
    const baseline = await recordBaseline(repo);
    await write("src/new feature.ts", "export const f = 1;\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "implementation"), [
      "src/new feature.ts",
    ]);
    assert.equal(state.hasImplementationChanges, true);
  });

  it("reports a renamed file once, under its new path", async () => {
    const baseline = await recordBaseline(repo);
    await execStrict("git", ["mv", "src/app.ts", "src/main.ts"], {
      cwd: repo,
    });

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes), ["src/main.ts"]);
  });

  it("flags a modified tracked .env as pollution", async () => {
    const baseline = await recordBaseline(repo);
    await write(".env", "TOKEN=leaked\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "pollution"), [".env"]);
    assert.equal(state.hasPollution, true);
    assert.ok(state.pollutionDetails.some((d) => d.includes('".env"')));
    assert.equal(state.hasImplementationChanges, false);
  });

  it("flags a new untracked log file as pollution", async () => {
    const baseline = await recordBaseline(repo);
    await write("debug.log", "trace\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "pollution"), ["debug.log"]);
  });

  it("keeps changes under .github/ and to .gitignore", async () => {
    const baseline = await recordBaseline(repo);
    await write(".github/workflows/ci.yml", "name: ci-changed\n");
    await write(".github/dependabot.yml", "version: 2\n");
    await write(".gitignore", "node_modules/\ndist/\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "implementation"), [
      ".github/dependabot.yml",
      ".github/workflows/ci.yml",
      ".gitignore",
    ]);
  });

  it("records .github/ and .gitignore as tracked in the baseline", async () => {
    const baseline = await recordBaseline(repo);

    assert.ok(baseline.trackedFiles.has(".gitignore"));
    assert.ok(baseline.trackedFiles.has(".github/workflows/ci.yml"));
  });

  it("classifies .agent/ and ralph.sh as scaffold, not implementation", async () => {
    const baseline = await recordBaseline(repo);
    await write(".agent/tasks.md", "- [ ] task\n");
    await write(".agent/PROMPT.md", "prompt\n");
    await write("ralph.sh", "#!/usr/bin/env bash\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "scaffold"), [
      ".agent/PROMPT.md",
      ".agent/tasks.md",
      "ralph.sh",
    ]);
    assert.equal(state.hasImplementationChanges, false);
    assert.equal(state.hasPollution, false);
  });

  it("flags pollution under .agent/ instead of treating it as scaffold", async () => {
    const baseline = await recordBaseline(repo);
    await write(".agent/session.log", "trace\n");

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "pollution"), [
      ".agent/session.log",
    ]);
  });

  it("reports the source of a rename into scaffold as an implementation change", async () => {
    const baseline = await recordBaseline(repo);
    await mkdir(path.join(repo, ".agent"), { recursive: true });
    await execStrict("git", ["mv", "src/app.ts", ".agent/app.ts"], {
      cwd: repo,
    });

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "implementation"), ["src/app.ts"]);
    assert.deepEqual(pathsOf(state.changes, "scaffold"), [".agent/app.ts"]);
    assert.equal(state.hasImplementationChanges, true);
  });

  it("does not count files already untracked at baseline as changes", async () => {
    await write("notes/local.md", "scratch\n");
    const baseline = await recordBaseline(repo);
    assert.ok(baseline.untrackedFiles.has("notes/local.md"));

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(state.changes, []);
    assert.equal(state.hasImplementationChanges, false);
  });

  it("still flags pollution that was already untracked at baseline", async () => {
    await write("server.log", "boot\n");
    const baseline = await recordBaseline(repo);

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(pathsOf(state.changes, "pollution"), ["server.log"]);
  });

  it("reports no changes for a clean worktree", async () => {
    const baseline = await recordBaseline(repo);

    const state = await readWorktreeState(repo, baseline);

    assert.deepEqual(state.changes, []);
    assert.equal(state.hasImplementationChanges, false);
    assert.equal(state.hasPollution, false);
  });
});

describe("recorded baseline", () => {
  it("loads exactly the baseline that preparation saved", async () => {
    await write("notes/local.md", "scratch\n");
    const baselinePath = path.join(
      repo,
      "..",
      `${path.basename(repo)}-baseline.json`,
    );
    await saveRecordedBaseline(baselinePath, await recordBaseline(repo));

    const loaded = await loadRecordedBaseline(baselinePath);

    assert.deepEqual([...loaded.untrackedFiles], ["notes/local.md"]);
    assert.ok(loaded.trackedFiles.has("src/app.ts"));
    await rm(baselinePath);
  });

  it("fails when no baseline was recorded, rather than taking a new one", async () => {
    await assert.rejects(
      () => loadRecordedBaseline(path.join(repo, "missing-baseline.json")),
      /No usable baseline recorded/,
    );
  });
});
