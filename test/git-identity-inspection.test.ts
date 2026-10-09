// test/git-identity-inspection.test.ts — Git identity resolution at the
// inspection seam (spec #133, ticket #146).
//
// Git is a genuine external boundary, so these tests use REAL temporary git
// repositories and read the identity the same way the inspection reads every
// other git fact: `git config --get <key>` with the repository as `cwd`.
//
// The host's own git configuration is isolated away (GIT_CONFIG_GLOBAL /
// GIT_CONFIG_NOSYSTEM), so the answer can only come from the repository under
// inspection — a developer's global user.name must never be handed to a
// project as if it were the project's identity.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectLocalRepository } from "../src/inspection/index.js";
import { execStrict } from "../src/proc.js";
import { startServer } from "../src/server.js";

let baseDir: string;
let server: ReturnType<typeof startServer>;
let baseUrl: string;

const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
  X_FACTORY_DATA_DIR: process.env.X_FACTORY_DATA_DIR,
  X_FACTORY_CONFIG_PATH: process.env.X_FACTORY_CONFIG_PATH,
};

/** Restores one environment variable to the value it had before the suite. */
function restoreEnv(key: keyof typeof savedEnv): void {
  const original = savedEnv[key];
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

/** Creates a real git repository configured with exactly `identity`. */
async function makeRepo(
  name: string,
  identity: { name?: string; email?: string },
): Promise<string> {
  const dir = path.join(baseDir, name);
  await execStrict("git", ["init", dir], { envPolicy: "inherit" });
  if (identity.name !== undefined) {
    await execStrict("git", ["config", "user.name", identity.name], {
      envPolicy: "inherit",
      cwd: dir,
    });
  }
  if (identity.email !== undefined) {
    await execStrict("git", ["config", "user.email", identity.email], {
      envPolicy: "inherit",
      cwd: dir,
    });
  }
  return dir;
}

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-git-identity-"));

  // Only the inspected repository's own configuration may decide the answer.
  const emptyGlobalConfig = path.join(baseDir, "empty-gitconfig");
  await writeFile(emptyGlobalConfig, "");
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  // Decoys: an agent session's author overrides must never be read as the
  // project's identity.
  process.env.GIT_AUTHOR_NAME = "Environment Decoy Author";
  process.env.GIT_AUTHOR_EMAIL = "decoy@environment.invalid";

  // The route tests must never touch real workflow state.
  process.env.X_FACTORY_DATA_DIR = path.join(baseDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = path.join(
    baseDir,
    "config",
    "projects.json",
  );

  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  restoreEnv("GIT_CONFIG_GLOBAL");
  restoreEnv("GIT_CONFIG_NOSYSTEM");
  restoreEnv("GIT_AUTHOR_NAME");
  restoreEnv("GIT_AUTHOR_EMAIL");
  restoreEnv("X_FACTORY_DATA_DIR");
  restoreEnv("X_FACTORY_CONFIG_PATH");
  await rm(baseDir, { recursive: true, force: true });
});

describe("Git identity from the inspected repository's configuration (#146)", () => {
  it("resolves both values from the repository's git configuration, never from the environment", async () => {
    const dir = await makeRepo("configured-repo", {
      name: "Repo Owner",
      email: "owner@example.com",
    });

    const result = await inspectLocalRepository(dir);

    expect(result.gitIdentity).toEqual({
      name: "Repo Owner",
      email: "owner@example.com",
    });
    // The decoys are in the environment and were NOT used.
    expect(result.gitIdentity?.name).not.toBe(process.env.GIT_AUTHOR_NAME);
    expect(result.gitIdentity?.email).not.toBe(process.env.GIT_AUTHOR_EMAIL);
  });

  it("reads each repository's own identity, not one shared default", async () => {
    const first = await makeRepo("team-a", {
      name: "Team A",
      email: "team-a@example.com",
    });
    const second = await makeRepo("team-b", {
      name: "Team B",
      email: "team-b@example.com",
    });

    const [firstResult, secondResult] = await Promise.all([
      inspectLocalRepository(first),
      inspectLocalRepository(second),
    ]);

    expect(firstResult.gitIdentity).toEqual({
      name: "Team A",
      email: "team-a@example.com",
    });
    expect(secondResult.gitIdentity).toEqual({
      name: "Team B",
      email: "team-b@example.com",
    });
  });

  it("reports the identity as ABSENT when only the name is configured", async () => {
    const dir = await makeRepo("name-only", { name: "Half Configured" });

    const result = await inspectLocalRepository(dir);

    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    // Absent — not {name: "Half Configured", email: ""}, and not a default.
    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports the identity as ABSENT when only the email is configured", async () => {
    const dir = await makeRepo("email-only", { email: "half@example.com" });

    const result = await inspectLocalRepository(dir);

    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports the identity as ABSENT when neither value is configured", async () => {
    const dir = await makeRepo("unconfigured", {});

    const result = await inspectLocalRepository(dir);

    expect(result.exists).toBe(true);
    expect(result.gitIdentity).toBeUndefined();
  });

  it("reports no identity for a path that does not exist", async () => {
    const result = await inspectLocalRepository(
      path.join(baseDir, "not-a-directory-12345"),
    );

    expect(result.exists).toBe(false);
    expect(result.gitIdentity).toBeUndefined();
  });

  it("surfaces the resolved identity through POST /api/projects/inspect-repository", async () => {
    const dir = await makeRepo("route-repo", {
      name: "Route Owner",
      email: "route@example.com",
    });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exists: boolean;
      gitIdentity?: { name: string; email: string };
    };
    expect(body.exists).toBe(true);
    expect(body.gitIdentity).toEqual({
      name: "Route Owner",
      email: "route@example.com",
    });
  });

  it("configures git identity locally and surfaces it on subsequent inspection (#161)", async () => {
    const dir = await makeRepo("unconfigured-for-setting", {});

    // Initially unconfigured
    const initial = await inspectLocalRepository(dir);
    expect(initial.gitIdentity).toBeUndefined();

    // Configure git identity via POST /api/projects/configure-git-identity
    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: dir,
        name: "Configured User",
        email: "configured@example.com",
        scope: "local",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      gitIdentity: { name: string; email: string };
      scope: string;
    };
    expect(body.gitIdentity).toEqual({
      name: "Configured User",
      email: "configured@example.com",
    });

    // Re-inspecting finds the configured identity
    const after = await inspectLocalRepository(dir);
    expect(after.gitIdentity).toEqual({
      name: "Configured User",
      email: "configured@example.com",
    });
  });

  it("writes to the redirected global config file with global scope (#161)", async () => {
    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: baseDir,
        name: "Global User",
        email: "global@example.com",
        scope: "global",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gitIdentity: { name: string; email: string };
      scope: string;
      path: string;
    };
    expect(body.gitIdentity).toEqual({
      name: "Global User",
      email: "global@example.com",
    });
    expect(body.scope).toBe("global");

    const globalName = await execStrict(
      "git",
      ["config", "--global", "user.name"],
      { envPolicy: "inherit" },
    );
    const globalEmail = await execStrict(
      "git",
      ["config", "--global", "user.email"],
      { envPolicy: "inherit" },
    );
    expect(globalName.stdout.trim()).toBe("Global User");
    expect(globalEmail.stdout.trim()).toBe("global@example.com");
  });

  it("returns 400 with DIRECTORY_MISSING code for non-existent path (#161)", async () => {
    const nonRepoDir = path.join(baseDir, "non-existent-dir");
    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: nonRepoDir,
        name: "Some User",
        email: "user@example.com",
        scope: "local",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("DIRECTORY_MISSING");
    expect(body.error).toContain("does not exist");
  });

  it("returns 400 with NOT_A_REPOSITORY code for existing non-repo directory (#161)", async () => {
    const nonRepoDir = path.join(baseDir, "existing-non-repo-dir");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(nonRepoDir, { recursive: true });

    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: nonRepoDir,
        name: "Some User",
        email: "user@example.com",
        scope: "local",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("NOT_A_REPOSITORY");
    expect(body.error).toContain("is not a git repository");
  });

  it("returns 400 with NOT_REPOSITORY_ROOT for a subdirectory of a repo, reports isGitRepo true and isRepositoryRoot false in inspection (#161)", async () => {
    const parentDir = await makeRepo("parent-repo", {
      name: "Parent Name",
      email: "parent@example.com",
    });
    const subDir = path.join(parentDir, "subfolder");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(subDir, { recursive: true });

    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: subDir,
        name: "Child Name",
        email: "child@example.com",
        scope: "local",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("NOT_REPOSITORY_ROOT");
    expect(body.error).toContain("is not the root of a git repository");

    const parentInspect = await inspectLocalRepository(parentDir);
    expect(parentInspect.gitIdentity).toEqual({
      name: "Parent Name",
      email: "parent@example.com",
    });
    expect(parentInspect.isGitRepo).toBe(true);
    expect(parentInspect.isRepositoryRoot).toBe(true);

    // Subdirectory reports isGitRepo: true, isRepositoryRoot: false, preserving topLevelDir
    const subInspect = await inspectLocalRepository(subDir);
    expect(subInspect.isGitRepo).toBe(true);
    expect(subInspect.isRepositoryRoot).toBe(false);
    const { realpath } = await import("node:fs/promises");
    expect(subInspect.topLevelDir).toBe(await realpath(parentDir));
  });

  it("returns 500 with GIT_CONFIG_WRITE_FAILED code and fixed message without leaking stderr on write failure (#161)", async () => {
    const dir = await makeRepo("write-fail-repo", {});
    const proc = await import("../src/proc.js");
    const { spyOn } = await import("bun:test");
    const origExec = proc.execCommand;
    const spy = spyOn(proc, "execCommand").mockImplementation(
      async (cmd, args, opts) => {
        if (args.includes("user.name") && !args.includes("--get")) {
          return {
            command: `${cmd} ${args.join(" ")}`,
            exitCode: 1,
            stdout: "",
            stderr:
              "error: could not lock config file /mock/.git/config: File exists",
            passed: false,
            durationMs: 0,
          };
        }
        return origExec(cmd, args, opts);
      },
    );

    try {
      const res = await fetch(
        `${baseUrl}/api/projects/configure-git-identity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: dir,
            name: "Lock Fail User",
            email: "lock@example.com",
            scope: "local",
          }),
        },
      );

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; code?: string };
      expect(body.code).toBe("GIT_CONFIG_WRITE_FAILED");
      expect(body.error).toBe("Failed to write local git configuration.");
      expect(JSON.stringify(body)).not.toContain("could not lock config file");
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 400 for an invalid email (#161)", async () => {
    const dir = await makeRepo("repo-for-invalid-email", {});
    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: dir,
        name: "User Name",
        email: "not-an-email",
        scope: "local",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for control characters in name (#161)", async () => {
    const dir = await makeRepo("repo-for-invalid-name", {});
    const res = await fetch(`${baseUrl}/api/projects/configure-git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: dir,
        name: "User\nName",
        email: "user@example.com",
        scope: "local",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("refuses unrequested git-identity route alias (#161)", async () => {
    const dir = await makeRepo("repo-for-alias-test", {});
    const res = await fetch(`${baseUrl}/api/projects/git-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: dir,
        name: "Alias User",
        email: "alias@example.com",
      }),
    });

    expect(res.status).toBe(404);
  });

  it("rolls back user.name if writing user.email fails (#161)", async () => {
    const dir = await makeRepo("rollback-repo", {
      name: "Original Name",
      email: "original@example.com",
    });

    const proc = await import("../src/proc.js");
    const { configureGitIdentity } = await import("../src/inspection/index.js");
    const { spyOn } = await import("bun:test");
    const origExec = proc.execCommand;
    const spy = spyOn(proc, "execCommand").mockImplementation(
      async (cmd, args, opts) => {
        if (args.includes("user.email") && !args.includes("--get")) {
          return {
            command: `${cmd} ${args.join(" ")}`,
            exitCode: 1,
            stdout: "",
            stderr: "fatal: simulated failure writing user.email",
            passed: false,
            durationMs: 0,
          };
        }
        return origExec(cmd, args, opts);
      },
    );

    try {
      await expect(
        configureGitIdentity({
          path: dir,
          name: "Attempted New Name",
          email: "new@example.com",
          scope: "local",
        }),
      ).rejects.toThrow();

      const after = await inspectLocalRepository(dir);
      expect(after.gitIdentity?.name).toBe("Original Name");
    } finally {
      spy.mockRestore();
    }
  });
});
