// test/data-dir-default.test.ts — A test file that sets nothing still gets a data dir outside HOME (#175).

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { getDataDir } from "../src/paths.js";

describe("Preloaded data dir keeps tests out of the home directory (#175)", () => {
  test("getDataDir() resolves outside the home directory without any setup in this file", () => {
    const dataDir = getDataDir();
    expect(path.relative(homedir(), dataDir).startsWith("..")).toBe(true);
    expect(dataDir).not.toBe(path.join(homedir(), ".x-factory"));
  });
});
