// test/git-auth.test.ts — Git authenticates with the git host connection's credentials:
// the header travels in the environment, scoped to the remote's origin, and never in argv,
// a .git/config, or an error message.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloneRepository, gitAuthEnv, redactGitAuth } from "../src/git.js";
import { execStrict } from "../src/proc.js";
import { azureGitCredentials } from "../src/providers/azure-module.js";
import { hasCapability } from "../src/providers/contract.js";
import { PROVIDER_REGISTRY } from "../src/providers/registry.js";

const REMOTE =
  "https://xynotech@dev.azure.com/xynotech/Converso/_git/ai-engine";
const PAT = "s3cretPATvalue1234567890";
const BASIC = `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;

describe("azure gitCredentials capability", () => {
  it("is a registered capability of the azure provider", () => {
    const azure = PROVIDER_REGISTRY.get("azure");
    expect(azure && hasCapability(azure, "gitCredentials")).toBe(true);
    const github = PROVIDER_REGISTRY.get("github");
    expect(github && hasCapability(github, "gitCredentials")).toBe(false);
  });

  it("gives a Basic header scoped to the remote's origin", () => {
    expect(azureGitCredentials({ pat: PAT }, REMOTE)).toEqual({
      origin: "https://dev.azure.com/",
      authorizationHeader: BASIC,
    });
  });

  it("gives nothing without a PAT, for another host, or for a non-https remote", () => {
    expect(azureGitCredentials({}, REMOTE)).toBeNull();
    expect(azureGitCredentials({ pat: "  " }, REMOTE)).toBeNull();
    expect(
      azureGitCredentials({ pat: PAT }, "https://github.com/a/b.git"),
    ).toBeNull();
    expect(
      azureGitCredentials({ pat: PAT }, "git@ssh.dev.azure.com:v3/o/p/r"),
    ).toBeNull();
    expect(azureGitCredentials({ pat: PAT }, "not a url")).toBeNull();
  });
});

describe("gitAuthEnv", () => {
  const auth = { origin: "https://dev.azure.com/", authorizationHeader: BASIC };

  it("is empty without credentials", () => {
    expect(gitAuthEnv(undefined)).toEqual({});
  });

  it("sets a scoped extraheader through GIT_CONFIG_*", () => {
    expect(gitAuthEnv(auth, {})).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://dev.azure.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: ${BASIC}`,
    });
  });

  it("appends to config entries already in the environment", () => {
    const env = gitAuthEnv(auth, { GIT_CONFIG_COUNT: "2" });
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_2).toBe(
      "http.https://dev.azure.com/.extraheader",
    );
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
  });
});

describe("redactGitAuth", () => {
  const auth = { origin: "https://dev.azure.com/", authorizationHeader: BASIC };
  it("removes the header and the token from text", () => {
    const text = `fatal: sent Authorization: ${BASIC} and ${BASIC.split(" ")[1]}`;
    const out = redactGitAuth(text, auth);
    expect(out).not.toContain(BASIC.split(" ")[1] as string);
    expect(out).toContain("[redacted]");
  });
});

describe("cloneRepository with credentials", () => {
  let baseDir: string;
  let remoteDir: string;
  beforeAll(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "xf-git-auth-"));
    const seed = path.join(baseDir, "seed");
    remoteDir = path.join(baseDir, "remote.git");
    const run = (args: string[], cwd: string) =>
      execStrict("git", args, { envPolicy: "inherit", cwd });
    await run(["init", "-b", "main", seed], baseDir);
    await run(["config", "user.name", "T"], seed);
    await run(["config", "user.email", "t@x.local"], seed);
    await writeFile(path.join(seed, "a.txt"), "a\n");
    await run(["add", "."], seed);
    await run(["commit", "-m", "init"], seed);
    await run(["clone", "--bare", seed, remoteDir], baseDir);
  });
  afterAll(() => rm(baseDir, { recursive: true, force: true }));

  it("leaves no extraheader or secret in the clone's .git/config", async () => {
    const target = path.join(baseDir, "clone");
    await cloneRepository(remoteDir, target, undefined, {
      origin: "https://dev.azure.com/",
      authorizationHeader: BASIC,
    });
    const config = await readFile(path.join(target, ".git", "config"), "utf-8");
    expect(config).not.toContain("extraheader");
    expect(config).not.toContain(PAT);
    expect(config).not.toContain(BASIC.split(" ")[1] as string);
  });

  it("does not echo the header when the clone fails", async () => {
    let message = "";
    try {
      await cloneRepository(
        path.join(baseDir, "missing.git"),
        path.join(baseDir, "clone2"),
        undefined,
        { origin: "https://dev.azure.com/", authorizationHeader: BASIC },
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("failed");
    expect(message).not.toContain(PAT);
    expect(message).not.toContain(BASIC.split(" ")[1] as string);
  });
});
