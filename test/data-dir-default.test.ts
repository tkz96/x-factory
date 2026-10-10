// test/data-dir-default.test.ts — A test file that sets nothing still gets a data dir and a Pi agent dir outside HOME (#175, #163 follow-up).

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getDataDir } from "../src/paths.js";
import { isInsideHome } from "./helpers/preload-data-dir.js";

describe("Preloaded data dir keeps tests out of the home directory (#175)", () => {
  test("getDataDir() resolves outside the home directory without any setup in this file", () => {
    const dataDir = getDataDir();
    expect(path.relative(homedir(), dataDir).startsWith("..")).toBe(true);
    expect(dataDir).not.toBe(path.join(homedir(), ".x-factory"));
  });
});

describe("Preload points Pi at a temp agent dir, never ~/.pi (#163 follow-up)", () => {
  test("Pi's agent dir resolves outside the home directory", () => {
    const agentDir = getAgentDir();
    expect(isInsideHome(agentDir)).toBe(false);
    expect(agentDir).not.toBe(path.join(homedir(), ".pi", "agent"));
  });

  test("Pi's sessions dir resolves outside the home directory", () => {
    const sessionsDir = path.join(getAgentDir(), "sessions");
    expect(isInsideHome(sessionsDir)).toBe(false);
  });

  test("the Pi agent/session env vars point outside the home directory", () => {
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const sessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
    expect(agentDir).toBeDefined();
    expect(sessionDir).toBeDefined();
    expect(isInsideHome(agentDir as string)).toBe(false);
    expect(isInsideHome(sessionDir as string)).toBe(false);
  });
});
