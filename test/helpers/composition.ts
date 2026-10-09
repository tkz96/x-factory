// test/helpers/composition.ts — builds the repository bundle a test drives the
// HTTP surface and run commands with, over a fresh migrated in-memory database.

import {
  createRepositories,
  type Repositories,
} from "../../src/composition-root.js";
import { createDatabase } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrator.js";

export function createTestRepositories(): Repositories {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  return createRepositories(db);
}
