// test/helpers/preload-data-dir.ts — Preloaded before every test file: no test can reach ~/.x-factory, repo config or ~/.pi/agent.

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

/** True when `target` is the home directory or lives inside it. */
export function isInsideHome(target: string): boolean {
  const relative = path.relative(homedir(), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

// Pi reads and writes its agent config (auth, models, sessions, settings) under
// `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`. Point it at a temp dir so
// a test can never touch the developer's real agent dir. An inherited non-home
// path (CI sets one) is kept.
if (
  !process.env.PI_CODING_AGENT_DIR ||
  isInsideHome(process.env.PI_CODING_AGENT_DIR)
) {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(
    path.join(tmpdir(), "xf-test-pi-agent-"),
  );
}
if (
  !process.env.PI_CODING_AGENT_SESSION_DIR ||
  isInsideHome(process.env.PI_CODING_AGENT_SESSION_DIR)
) {
  process.env.PI_CODING_AGENT_SESSION_DIR = mkdtempSync(
    path.join(tmpdir(), "xf-test-pi-sessions-"),
  );
}

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
