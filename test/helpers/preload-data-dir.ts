// test/helpers/preload-data-dir.ts — Preloaded before every test file: no test can reach ~/.x-factory or repo config.

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Delete any inherited X_FACTORY_DB_PATH so database paths derive from the isolated data dir.
delete process.env.X_FACTORY_DB_PATH;

// Keeps an externally set X_FACTORY_DATA_DIR (for example, one set by check:all).
if (!process.env.X_FACTORY_DATA_DIR) {
  process.env.X_FACTORY_DATA_DIR = mkdtempSync(
    path.join(tmpdir(), "xf-test-data-"),
  );
}
const testDataDir = process.env.X_FACTORY_DATA_DIR;

// Isolate projects config so tests never touch repo's config/projects.json (#163).
const repoConfigPath = path.join(process.cwd(), "config", "projects.json");
if (
  !process.env.X_FACTORY_CONFIG_PATH ||
  path.resolve(process.env.X_FACTORY_CONFIG_PATH) === repoConfigPath
) {
  const testConfigPath = path.join(testDataDir, "projects.json");
  if (!existsSync(testConfigPath)) {
    writeFileSync(
      testConfigPath,
      `${JSON.stringify({ projects: [] }, null, 2)}\n`,
      "utf8",
    );
  }
  process.env.X_FACTORY_CONFIG_PATH = testConfigPath;
}
