// test/repository-path.test.ts — where a project's repository checkout is
// recorded when a project is created (#283).

import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { resolveRepositoryPath } from "../src/services/repository-path.js";

const ROOT = "/work/root";

/** A fake filesystem: the set of paths that exist. */
function fsWith(...existing: string[]) {
  const set = new Set(existing);
  return (p: string) => set.has(p);
}

describe("resolveRepositoryPath", () => {
  it("uses an explicit local path verbatim (absolute)", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "web", localPath: "/elsewhere/web" },
        repositoryCount: 1,
        exists: fsWith(),
      }),
    ).toBe("/elsewhere/web");
  });

  it("expands ~ in a local path and in the workspace root", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "web", localPath: "~/code/web" },
        repositoryCount: 1,
        exists: fsWith(),
      }),
    ).toBe(path.join(homedir(), "code/web"));
    expect(
      resolveRepositoryPath({
        workspacePath: "~/work",
        repository: { name: "web" },
        repositoryCount: 2,
        exists: fsWith(),
      }),
    ).toBe(path.join(homedir(), "work/web"));
  });

  it("puts a repository under the workspace root when the root is not itself its checkout", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "web" },
        repositoryCount: 1,
        exists: fsWith(),
      }),
    ).toBe("/work/root/web");
  });

  it("uses the root itself when a single repository's root IS a git checkout and has no such subfolder (the dogfood case)", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "x-factory" },
        repositoryCount: 1,
        exists: fsWith("/work/root/.git"),
      }),
    ).toBe(ROOT);
  });

  it("prefers an existing subfolder named after the repository even if the root is a checkout", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "web" },
        repositoryCount: 1,
        exists: fsWith("/work/root/.git", "/work/root/web"),
      }),
    ).toBe("/work/root/web");
  });

  it("never collapses several repositories onto the root", () => {
    expect(
      resolveRepositoryPath({
        workspacePath: ROOT,
        repository: { name: "api" },
        repositoryCount: 2,
        exists: fsWith("/work/root/.git"),
      }),
    ).toBe("/work/root/api");
  });
});
