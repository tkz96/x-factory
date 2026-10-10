// test/temp-dirs.test.ts — A temp dir must not be derived from the clock (#163 follow-up).
//
// Root cause of the XFM-72 backup flake: two test processes that start in the
// same millisecond both asked for `test-live-${Date.now()}.db` and opened the
// same SQLite file, so the second insert hit `UNIQUE constraint failed: runs.id`.

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { rmSync } from "node:fs";
import { createTempDir } from "./helpers/temp-dirs.js";

describe("createTempDir is collision-proof (#163 follow-up)", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hands out distinct directories even when the clock is frozen", () => {
    const frozen = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const first = createTempDir("xf-temp-dir-");
      const second = createTempDir("xf-temp-dir-");
      created.push(first, second);
      expect(first).not.toBe(second);
    } finally {
      frozen.mockRestore();
    }
  });
});
