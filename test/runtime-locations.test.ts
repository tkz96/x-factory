// test/runtime-locations.test.ts — Every on-disk runtime location derives from X_FACTORY_DATA_DIR (#175).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getBackupLocations,
  getDatabasePath,
  getDataDir,
  getProjectsConfigPath,
  getRunDir,
  getSettingsPath,
  getWorktreePath,
} from "../src/paths.js";
import { loadSettings, saveSettings } from "../src/settings.js";

const ENV_KEYS = [
  "X_FACTORY_DATA_DIR",
  "X_FACTORY_DB_PATH",
  "X_FACTORY_CONFIG_PATH",
  "HOME",
] as const;

describe("Runtime locations derive from X_FACTORY_DATA_DIR (#175)", () => {
  let saved: Record<string, string | undefined>;
  let sandbox: string;
  let dataDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    sandbox = await mkdtemp(path.join(tmpdir(), "xf-runtime-locations-"));
    dataDir = path.join(sandbox, "data");
    fakeHome = path.join(sandbox, "home");
    process.env.HOME = fakeHome;
    process.env.X_FACTORY_DATA_DIR = dataDir;
    delete process.env.X_FACTORY_DB_PATH;
    delete process.env.X_FACTORY_CONFIG_PATH;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(sandbox, { recursive: true, force: true });
  });

  test("the path helpers resolve under the data dir", () => {
    expect(getDataDir()).toBe(dataDir);
    expect(getSettingsPath()).toBe(path.join(dataDir, "settings.json"));
    expect(getDatabasePath()).toBe(path.join(dataDir, "x-factory.db"));
    expect(getBackupLocations()).toEqual({
      backupsDir: path.join(dataDir, "backups"),
      artifactsDir: path.join(dataDir, "artifacts"),
    });
    expect(getRunDir("proj-1", "run-1")).toBe(
      path.join(dataDir, "projects", "proj-1", "runs", "run-1"),
    );
    expect(getWorktreePath("proj-1", "run-1")).toBe(
      path.join(dataDir, "projects", "proj-1", "worktrees", "run-1"),
    );
  });

  test("saveSettings writes settings.json into the data dir, not the home directory", async () => {
    await saveSettings({ theme: "light" });

    const written = path.join(dataDir, "settings.json");
    const fileStat = await stat(written);
    if (process.platform !== "win32") {
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(await readFile(written, "utf-8")).theme).toBe("light");
    await expect(
      stat(path.join(fakeHome, ".x-factory", "settings.json")),
    ).rejects.toThrow();
  });

  test("loadSettings reads settings.json from the data dir", async () => {
    await saveSettings({ theme: "light" });
    await writeFile(
      path.join(dataDir, "settings.json"),
      JSON.stringify({ theme: "dark" }),
    );

    const settings = await loadSettings();
    expect(settings.theme).toBe("dark");
  });

  test("the projects configuration keeps its X_FACTORY_CONFIG_PATH override", () => {
    expect(getProjectsConfigPath()).toBe(
      path.join(process.cwd(), "config", "projects.json"),
    );
    process.env.X_FACTORY_CONFIG_PATH = "/literal/override/projects.json";
    expect(getProjectsConfigPath()).toBe("/literal/override/projects.json");
  });
});
