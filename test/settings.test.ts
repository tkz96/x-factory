// test/settings.test.ts — Unit tests for settings engine, secret masking, and API routes.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { stat, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadSettings,
  saveSettings,
  maskSecret,
  isMasked,
  maskSettings,
} from "../src/settings.js";


const TEST_SETTINGS_PATH = path.join(
  os.tmpdir(),
  `xf-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
);

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

  test("maskSettings masks all provider credentials", () => {
    const masked = maskSettings({
      activeTracker: "github",
      github: { token: "ghp_1234567890abcdef", repo: "org/repo" },
      jira: { host: "jira.com", email: "user@jira.com", token: "secret-token-1234" },
      azure: { orgUrl: "https://dev.azure.com", pat: "azure-pat-987654321" },
    });

    expect(masked.github?.token).toContain("••••");
    expect(masked.jira?.token).toContain("••••");
    expect(masked.azure?.pat).toContain("••••");
    expect(masked.github?.repo).toBe("org/repo");
  });
});

describe("Settings Storage & Persistence", () => {
  beforeEach(() => {
    process.env.XF_SETTINGS_PATH = TEST_SETTINGS_PATH;
  });

  afterEach(async () => {
    try {
      await unlink(TEST_SETTINGS_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
    delete process.env.XF_SETTINGS_PATH;
  });

  test("loadSettings returns defaults when file does not exist", async () => {
    const settings = await loadSettings();
    expect(settings.activeTracker).toBe("github");
    expect(settings.models?.sessionA?.model).toBe("claude-3-7-sonnet");
  });

  test("saveSettings persists settings to disk with 0600 mode", async () => {
    await saveSettings({
      activeTracker: "jira",
      jira: {
        host: "test.atlassian.net",
        email: "test@example.com",
        token: "real-jira-token-1234",
        project: "TEST",
      },
      models: {
        sessionA: { provider: "ollama", model: "qwen2.5-coder:32b" },
      },
    });

    const fileStat = await stat(TEST_SETTINGS_PATH);
    // On POSIX, check mode & 0o777 === 0o600
    if (process.platform !== "win32") {
      expect(fileStat.mode & 0o777).toBe(0o600);
    }

    const raw = await readFile(TEST_SETTINGS_PATH, "utf-8");
    const onDisk = JSON.parse(raw);
    expect(onDisk.activeTracker).toBe("jira");
    expect(onDisk.jira?.token).toBe("real-jira-token-1234");
    expect(onDisk.models?.sessionA?.model).toBe("qwen2.5-coder:32b");
  });

  test("saveSettings preserves existing secret when masked token is submitted", async () => {
    // Step 1: Save initial secret
    await saveSettings({
      github: { token: "ghp_supersecretvalue1234", repo: "user/app" },
    });

    // Step 2: User UI loads masked settings and saves back with mask
    const masked = await loadSettings(true);
    expect(isMasked(masked.github?.token)).toBe(true);

    // Save update with the masked token (e.g. user only changed repo)
    await saveSettings({
      github: { token: masked.github?.token, repo: "user/app-updated" },
    });

    // Step 3: Verify unmasked token on disk is preserved intact
    const unmasked = await loadSettings(false);
    expect(unmasked.github?.token).toBe("ghp_supersecretvalue1234");
    expect(unmasked.github?.repo).toBe("user/app-updated");
  });
});
