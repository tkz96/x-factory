// test/git-project-identity.test.ts — a project's git identity authors every X-Factory commit (A).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as git from "../src/git.js";
import { execStrict } from "../src/proc.js";
import { recordBaseline } from "../src/worktree-state.js";

let dir: string;
let repo: string;

async function sh(args: string[], cwd = repo): Promise<string> {
  return (await execStrict("git", args, { cwd, envPolicy: "inherit" })).stdout;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "xf-identity-"));
  repo = path.join(dir, "repo");
  await execStrict("git", ["init", "--initial-branch=main", repo], {
    envPolicy: "inherit",
  });
  await sh(["config", "user.name", "Personal Me"]);
  await sh(["config", "user.email", "me@personal.example"]);
  await writeFile(path.join(repo, "README.md"), "x\n");
  await sh(["add", "-A"]);
  await sh(["commit", "-m", "init"]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("safeCommitAll with a project identity", () => {
  it("authors the commit as the project identity and writes no git config", async () => {
    const baseline = await recordBaseline(repo);
    await writeFile(path.join(repo, "a.ts"), "export {};\n");
    const configBefore = await readFile(
      path.join(repo, ".git", "config"),
      "utf8",
    );

    await git.safeCommitAll(repo, "with identity", baseline, {
      name: "Work Name",
      email: "work@corp.example",
    });

    expect(
      (await sh(["log", "-1", "--format=%an <%ae>|%cn <%ce>"])).trim(),
    ).toBe("Work Name <work@corp.example>|Work Name <work@corp.example>");
    expect(await readFile(path.join(repo, ".git", "config"), "utf8")).toBe(
      configBefore,
    );
  });

  it("falls back to git config when the project has no identity", async () => {
    const baseline = await recordBaseline(repo);
    await writeFile(path.join(repo, "b.ts"), "export {};\n");
    await git.safeCommitAll(repo, "no identity", baseline);
    expect((await sh(["log", "-1", "--format=%an <%ae>"])).trim()).toBe(
      "Personal Me <me@personal.example>",
    );
  });
});
