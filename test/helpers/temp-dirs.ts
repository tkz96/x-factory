// test/helpers/temp-dirs.ts — Collision-proof temp directories for tests.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A fresh directory under the OS temp dir.
 *
 * `mkdtemp` asks the OS to create a unique name atomically, so two processes can
 * never receive the same path — unlike a name built from `Date.now()`, which
 * collides whenever both runs start in the same millisecond (#163 follow-up).
 */
export function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}
