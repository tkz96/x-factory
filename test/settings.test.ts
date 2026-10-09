// test/settings.test.ts — Unit tests for global settings (theme, models) and secret masking.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isMasked,
  loadSettings,
  maskSecret,
  maskSettings,
  saveSettings,
} from "../src/settings.js";

describe("Settings Secret Masking", () => {
  test("maskSecret masks tokens properly", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("short")).toBe("••••••••");
    expect(maskSecret("ghp_1234567890abcdef")).toBe("ghp_••••••••cdef");
  });

  test("isMasked detects masked values", () => {
    expect(isMasked("ghp_••••••••cdef")).toBe(true);
    expect(isMasked("ghp_********cdef")).toBe(true);
    expect(isMasked("ghp_realtoken123456")).toBe(false);
    expect(isMasked("")).toBe(false);
  });

  test("maskSettings returns settings cleanly", () => {
    const settings = {
      theme: "dark" as const,
      models: {
        sessionA: { provider: "anthropic", model: "claude-3-7-sonnet" },
      },
    };
    const masked = maskSettings(settings);
    expect(masked.theme).toBe("dark");
    expect(masked.models?.sessionA?.model).toBe("claude-3-7-sonnet");
  });
});

describe("Settings Storage & Persistence", () => {
  let previousDataDir: string | undefined;
  let dataDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    previousDataDir = process.env.X_FACTORY_DATA_DIR;
    dataDir = await mkdtemp(path.join(tmpdir(), "xf-test-settings-"));
    process.env.X_FACTORY_DATA_DIR = dataDir;
    settingsPath = path.join(dataDir, "settings.json");
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
    else process.env.X_FACTORY_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("loadSettings returns defaults when file does not exist", async () => {
    const settings = await loadSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.models?.sessionA?.model).toBe("claude-3-7-sonnet");
  });

  test("saveSettings persists settings to disk with 0600 mode", async () => {
    await saveSettings({
      theme: "light",
      models: {
        sessionA: { provider: "ollama", model: "qwen2.5-coder:32b" },
      },
    });

    const fileStat = await stat(settingsPath);
    // On POSIX, check mode & 0o777 === 0o600
    if (process.platform !== "win32") {
      expect(fileStat.mode & 0o777).toBe(0o600);
    }

    const raw = await readFile(settingsPath, "utf-8");
    const onDisk = JSON.parse(raw);
    expect(onDisk.theme).toBe("light");
    expect(onDisk.models?.sessionA?.model).toBe("qwen2.5-coder:32b");
  });

  test("saveSettings persists theme preference", async () => {
    const defaults = await loadSettings();
    expect(defaults.theme).toBe("dark");

    await saveSettings({ theme: "light" });
    const updated = await loadSettings();
    expect(updated.theme).toBe("light");
  });
});

describe("Settings legacy model entries (#182)", () => {
  let previousDataDir: string | undefined;
  let dataDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    previousDataDir = process.env.X_FACTORY_DATA_DIR;
    dataDir = await mkdtemp(path.join(tmpdir(), "xf-test-settings-legacy-"));
    process.env.X_FACTORY_DATA_DIR = dataDir;
    settingsPath = path.join(dataDir, "settings.json");
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
    else process.env.X_FACTORY_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("a legacy string model entry loads as that model with the default provider", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ theme: "dark", models: { sessionA: "gpt-4" } }),
      "utf-8",
    );

    const settings = await loadSettings();
    expect(settings.models?.sessionA).toEqual({
      provider: "anthropic",
      model: "gpt-4",
    });
  });

  test("an index-spread model entry loads as the model string it spells", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        theme: "dark",
        models: {
          sessionA: { "0": "g", "1": "p", "2": "t", "3": "-", "4": "4" },
        },
      }),
      "utf-8",
    );

    const settings = await loadSettings();
    expect(settings.models?.sessionA).toEqual({
      provider: "anthropic",
      model: "gpt-4",
    });
  });

  test("the next save writes a clean {provider, model} entry, never index keys", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        theme: "dark",
        models: {
          sessionA: "gpt-4",
          sessionB: { "0": "q", "1": "w", "2": "e" },
        },
      }),
      "utf-8",
    );

    await loadSettings();
    await saveSettings({ theme: "light" });

    const raw = await readFile(settingsPath, "utf-8");
    const onDisk = JSON.parse(raw) as {
      theme: string;
      models: { sessionA: unknown; sessionB: unknown };
    };
    expect(onDisk.theme).toBe("light");
    expect(onDisk.models.sessionA).toEqual({
      provider: "anthropic",
      model: "gpt-4",
    });
    expect(onDisk.models.sessionB).toEqual({
      provider: "anthropic",
      model: "qwe",
    });
  });
});
