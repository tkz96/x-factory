// test/project-env.test.ts — Unit tests for per-project secret env storage.

import { afterEach, describe, expect, it } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { getProjectDir, getProjectEnvPath } from "../src/paths.js";
import {
  formatEnvContent,
  getProjectSecret,
  loadProjectEnv,
  PROJECT_ENV_KEYS,
  parseEnvContent,
  saveProjectEnv,
} from "../src/project-env.js";

describe("Project Environment Secret Storage (src/project-env.ts)", () => {
  const testProjectId = `test-env-proj-${Date.now()}`;

  afterEach(async () => {
    try {
      await rm(getProjectDir(testProjectId), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("parseEnvContent", () => {
    it("parses key=value lines correctly", () => {
      const content = `
# Comment
KEY1=value1
KEY2="quoted value"
KEY3='single quoted'
INVALID_LINE_NO_EQUALS
EMPTY_LINE=
      `;
      const parsed = parseEnvContent(content);
      expect(parsed.KEY1).toBe("value1");
      expect(parsed.KEY2).toBe("quoted value");
      expect(parsed.KEY3).toBe("single quoted");
      expect(parsed.EMPTY_LINE).toBe("");
      expect(parsed.INVALID_LINE_NO_EQUALS).toBeUndefined();
    });

    it("returns empty object for empty or whitespace content", () => {
      expect(parseEnvContent("")).toEqual({});
      expect(parseEnvContent("   \n\n# only comments\n")).toEqual({});
    });
  });

  describe("formatEnvContent", () => {
    it("formats key-value pairs into valid .env format", () => {
      const vars = {
        FOO: "bar",
        SPACED: "hello world",
      };
      const formatted = formatEnvContent(vars);
      expect(formatted).toContain("FOO=bar");
      expect(formatted).toContain('SPACED="hello world"');
      expect(formatted).toContain("# X-Factory per-project secrets");
    });
  });

  describe("loadProjectEnv and saveProjectEnv", () => {
    it("returns empty object when no .env exists for project", async () => {
      const env = await loadProjectEnv("nonexistent-project-xyz");
      expect(env).toEqual({});
    });

    it("saves secrets and sets restrictive permissions (0o600)", async () => {
      await saveProjectEnv(testProjectId, {
        [PROJECT_ENV_KEYS.AZURE_PAT]: "secret-pat-123",
        [PROJECT_ENV_KEYS.GITHUB_TOKEN]: "ghp_secret456",
      });

      const loaded = await loadProjectEnv(testProjectId);
      expect(loaded[PROJECT_ENV_KEYS.AZURE_PAT]).toBe("secret-pat-123");
      expect(loaded[PROJECT_ENV_KEYS.GITHUB_TOKEN]).toBe("ghp_secret456");

      const envPath = getProjectEnvPath(testProjectId);
      const st = await stat(envPath);
      // Mode should be 0o600 (read/write by owner only) on Unix
      const mode = st.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("merges new secrets and ignores masked values", async () => {
      await saveProjectEnv(testProjectId, {
        [PROJECT_ENV_KEYS.AZURE_PAT]: "original-secret",
        OTHER: "value",
      });

      // Attempt to save with masked secret (e.g. from UI)
      await saveProjectEnv(testProjectId, {
        [PROJECT_ENV_KEYS.AZURE_PAT]: "••••••••cret",
        NEW_KEY: "new_value",
      });

      const loaded = await loadProjectEnv(testProjectId);
      expect(loaded[PROJECT_ENV_KEYS.AZURE_PAT]).toBe("original-secret");
      expect(loaded.OTHER).toBe("value");
      expect(loaded.NEW_KEY).toBe("new_value");
    });

    it("deletes a key when set to empty string", async () => {
      await saveProjectEnv(testProjectId, {
        KEY_TO_DELETE: "secret",
        KEY_TO_KEEP: "keep",
      });

      await saveProjectEnv(testProjectId, {
        KEY_TO_DELETE: "",
      });

      const loaded = await loadProjectEnv(testProjectId);
      expect(loaded.KEY_TO_DELETE).toBeUndefined();
      expect(loaded.KEY_TO_KEEP).toBe("keep");
    });
  });

  describe("getProjectSecret", () => {
    it("retrieves secret from project .env", async () => {
      await saveProjectEnv(testProjectId, {
        TEST_SECRET: "proj-secret-val",
      });

      const secret = await getProjectSecret(testProjectId, "TEST_SECRET");
      expect(secret).toBe("proj-secret-val");
    });

    it("falls back to process.env if not in project .env", async () => {
      process.env.GLOBAL_FALLBACK_TEST = "global-secret";
      try {
        const secret = await getProjectSecret(
          testProjectId,
          "GLOBAL_FALLBACK_TEST",
        );
        expect(secret).toBe("global-secret");
      } finally {
        delete process.env.GLOBAL_FALLBACK_TEST;
      }
    });

    it("returns undefined if secret is not in .env or process.env", async () => {
      const secret = await getProjectSecret(
        testProjectId,
        "NONEXISTENT_KEY_123",
      );
      expect(secret).toBeUndefined();
    });
  });
});
