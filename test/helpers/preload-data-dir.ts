// test/helpers/preload-data-dir.ts — Preloaded before every test file: no test can reach ~/.x-factory.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Keeps an externally set X_FACTORY_DATA_DIR (for example, one set by check:all).
process.env.X_FACTORY_DATA_DIR ||= mkdtempSync(
  path.join(tmpdir(), "xf-test-data-"),
);
