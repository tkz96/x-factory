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

  test("loadSettings returns defaults when file does not exist, with no default model (#278)", async () => {
    const settings = await loadSettings();
    expect(settings.theme).toBe("default");
    expect(settings.appearance).toBe("automatic");
    expect(settings.models?.sessionA?.model).toBeUndefined();
    expect(settings.models?.sessionA?.provider).toBeUndefined();
  });

  test("saveSettings persists settings to disk with 0600 mode", async () => {
    await saveSettings({
      appearance: "light",
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
    expect(onDisk.appearance).toBe("light");
    expect(onDisk.models?.sessionA?.model).toBe("qwen2.5-coder:32b");
  });

  test("saveSettings persists appearance preference (#248)", async () => {
    const defaults = await loadSettings();
    expect(defaults.theme).toBe("default");
    expect(defaults.appearance).toBe("automatic");

    await saveSettings({ appearance: "dark" });
    const updated = await loadSettings();
    expect(updated.appearance).toBe("dark");
  });

  test("settings saved before Appearance existed start at Automatic (#248)", async () => {
    // theme "dark" was the old default, written for every install: not a choice.
    await writeFile(settingsPath, JSON.stringify({ theme: "dark" }));
    const migrated = await loadSettings(false);
    expect(migrated.theme).toBe("default");
    expect(migrated.appearance).toBe("automatic");
  });

  test("loadSettings defaults allowUnsandboxed to false", async () => {
    const defaults = await loadSettings();
    expect(defaults.allowUnsandboxed).toBe(false);
  });

  test("saveSettings persists allowUnsandboxed preference", async () => {
    await saveSettings({ allowUnsandboxed: true });
    const updated = await loadSettings();
    expect(updated.allowUnsandboxed).toBe(true);

    const raw = await readFile(settingsPath, "utf-8");
    const onDisk = JSON.parse(raw);
    expect(onDisk.allowUnsandboxed).toBe(true);

    await saveSettings({ allowUnsandboxed: false });
    const reverted = await loadSettings();
    expect(reverted.allowUnsandboxed).toBe(false);
  });

  test("loadSettings defaults desktopNotifications to off (#265)", async () => {
    const defaults = await loadSettings();
    expect(defaults.desktopNotifications).toBe(false);
  });

  test("saveSettings persists the desktop notifications preference (#265)", async () => {
    await saveSettings({ desktopNotifications: true });
    const updated = await loadSettings();
    expect(updated.desktopNotifications).toBe(true);

    // A later save of another setting keeps the preference.
    await saveSettings({ appearance: "dark" });
    expect((await loadSettings()).desktopNotifications).toBe(true);

    await saveSettings({ desktopNotifications: false });
    expect((await loadSettings()).desktopNotifications).toBe(false);
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

  test("a legacy string model entry loads as that model, with no provider since there is no default (#278)", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ theme: "dark", models: { sessionA: "gpt-4" } }),
      "utf-8",
    );

    const settings = await loadSettings();
    expect(settings.models?.sessionA).toEqual({ model: "gpt-4" });
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
    expect(settings.models?.sessionA).toEqual({ model: "gpt-4" });
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
    expect(onDisk.models.sessionA).toEqual({ model: "gpt-4" });
    expect(onDisk.models.sessionB).toEqual({ model: "qwe" });
  });
});
