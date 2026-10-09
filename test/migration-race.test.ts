// test/migration-race.test.ts — Two processes migrating the same fresh database file at
// once must both succeed. Before the fix, both read schema version 0 outside the
// transaction and both tried to apply migration 1, so one failed with
// "UNIQUE constraint failed: schema_migrations.version" (or SQLITE_BUSY while opening).

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { execStrict } from "../src/proc.js";

const connectionModule = path.join(import.meta.dir, "../src/db/connection.ts");
const migratorModule = path.join(import.meta.dir, "../src/db/migrator.ts");

// Runs in a child Bun process: wait for the shared start instant, then migrate.
// Inlined with `bun -e` so the test needs no extra helper file.
const childScript = `
import { createDatabase } from ${JSON.stringify(connectionModule)};
import { runMigrations } from ${JSON.stringify(migratorModule)};
const startAt = Number(process.env.RACE_START_AT);
while (Date.now() < startAt) {
  // busy-wait: a sleep would add scheduler jitter to the race window
}
const db = createDatabase({ path: process.env.RACE_DB_PATH });
try {
  console.log(JSON.stringify(runMigrations(db)));
} finally {
  db.close();
}
`;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function freshDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xf-migration-race-"));
  tempDirs.push(dir);
  return path.join(dir, "race.db");
}

describe("concurrent startup migrations", () => {
  it("two processes migrating the same fresh file both succeed, each version once", async () => {
    const rounds = 4;
    for (let round = 0; round < rounds; round++) {
      const dbPath = freshDbPath();
      // Both children boot, then spin until this shared instant.
      const startAt = String(Date.now() + 1500);

      const runs = await Promise.all(
        [1, 2].map(() =>
          execStrict(process.execPath, ["-e", childScript], {
            envPolicy: "inherit",
            env: { RACE_DB_PATH: dbPath, RACE_START_AT: startAt },
          }),
        ),
      );

      const results = runs.map(
        (run) =>
          JSON.parse(run.stdout.trim()) as {
            applied: number;
            currentVersion: number;
          },
      );
      const appliedTotal = results.reduce((sum, r) => sum + r.applied, 0);

      const db = createDatabase({ path: dbPath });
      try {
        const rows = db
          .query(
            "SELECT version, COUNT(*) AS n FROM schema_migrations GROUP BY version ORDER BY version;",
          )
          .all() as Array<{ version: number; n: number }>;
        expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(rows.map((r) => r.n)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);

        const latest = db
          .query("SELECT MAX(version) AS v FROM schema_migrations;")
          .get() as { v: number };
        expect(latest.v).toBe(9);
      } finally {
        db.close();
      }

      // Each migration is applied by exactly one of the two processes.
      expect(appliedTotal).toBe(9);
      expect(results.map((r) => r.currentVersion)).toEqual([9, 9]);
    }
  }, 60_000);
});
