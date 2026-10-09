// test/migration-race.test.ts — Two processes migrating the same fresh database file at
// once must both succeed. Before the fix, both read schema version 0 outside the
// transaction and both tried to apply migration 1, so one failed with
// "UNIQUE constraint failed: schema_migrations.version" (or SQLITE_BUSY while opening).

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { loadMigrations } from "../src/db/migrator.js";
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

// The migrations on disk define what a complete run looks like, so the test
// does not hardcode a count or a latest version.
const expectedVersions = loadMigrations().map((m) => m.version);
const latestVersion = expectedVersions[expectedVersions.length - 1] ?? 0;

// Both children must boot before the shared start instant. Booting a Bun process
// and loading the migrator takes well under a second on a laptop, but a loaded CI
// host can take several. The margin is 5 seconds so both children are ready
// before either starts migrating, and each child gets its own 60-second timeout
// so a stuck boot fails the run instead of hanging it.
const START_MARGIN_MS = 5_000;
const CHILD_TIMEOUT_MS = 60_000;
const ROUNDS = 4;

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
  it(
    "two processes migrating the same fresh file both succeed, each version once",
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const dbPath = freshDbPath();
        const startAt = String(Date.now() + START_MARGIN_MS);

        const runs = await Promise.all(
          [1, 2].map(() =>
            execStrict(process.execPath, ["-e", childScript], {
              envPolicy: "inherit",
              timeoutMs: CHILD_TIMEOUT_MS,
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
          expect(rows.map((r) => r.version)).toEqual(expectedVersions);
          expect(rows.map((r) => r.n)).toEqual(expectedVersions.map(() => 1));
        } finally {
          db.close();
        }

        // Each migration is applied by exactly one of the two processes.
        expect(appliedTotal).toBe(expectedVersions.length);
        expect(results.map((r) => r.currentVersion)).toEqual([
          latestVersion,
          latestVersion,
        ]);
      }
    },
    ROUNDS * (START_MARGIN_MS + 30_000),
  );
});
