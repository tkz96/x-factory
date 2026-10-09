// test/connection-role-list.test.ts — #176: ONE role list in the frontend.
//
// `PROJECT_CONNECTION_ROLES` (`src/shared/types.ts`) is THE runtime list of
// connection roles and `ProjectConnectionRole` is THE type; they are tied
// together by `satisfies`, so a role added to one breaks the other at compile
// time. This scan fails the moment any frontend file writes its own copy of
// the pair — a literal tuple or a re-declared union — so the second list can
// never exist quietly next to the shared one.
//
// Deliberately NOT scanned: `REQUIRED_CONNECTION_ROLES` (`["tracker"]`) is a
// one-role requirement for the tone rule, not a list of the provider roles, and
// the shared definition itself lives in `src/shared/`, outside this scan.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const FRONTEND_ROOT = join(REPO_ROOT, "src", "frontend");

/** Every literal spelling of "the two roles" that would duplicate THE list. */
const SECOND_LIST_PATTERNS: readonly RegExp[] = [
  /\[\s*"tracker"\s*,\s*"gitHost"\s*\]/,
  /\[\s*"gitHost"\s*,\s*"tracker"\s*\]/,
  /"tracker"\s*\|\s*"gitHost"/,
  /"gitHost"\s*\|\s*"tracker"/,
];

function frontendSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...frontendSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("one connection role list in the frontend", () => {
  it("never re-writes the role pair as a literal list or union outside the shared definition", () => {
    const offenders: string[] = [];
    for (const file of frontendSourceFiles(FRONTEND_ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (SECOND_LIST_PATTERNS.some((pattern) => pattern.test(line))) {
          offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
