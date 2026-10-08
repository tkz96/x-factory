// scripts/knip-baseline.ts — Runs knip and fails only on findings that are not
// in the committed baseline, so a change is judged on what it adds.
//
// Knip has no baseline of its own (fallow does: see the check:fallow script).
// A finding's key is "<file>:<category>:<name>", with no line numbers, so it
// survives unrelated edits. Every category counts, including the ones knip.json
// downgrades to warnings, because "0 unused exports" is the target.
//
// Usage:
//   bun scripts/knip-baseline.ts           exit 1 on new or fixed-but-listed findings
//   bun scripts/knip-baseline.ts --update  rewrite the baseline from the current run

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const BASELINE_PATH = path.join(import.meta.dir, "baselines", "knip.json");

interface KnipIssue {
  file: string;
  [category: string]: unknown;
}

function findingKeys(issues: KnipIssue[]): string[] {
  const keys: string[] = [];
  for (const issue of issues) {
    for (const [category, value] of Object.entries(issue)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const name = (item as { name?: string }).name;
        if (name) keys.push(`${issue.file}:${category}:${name}`);
      }
    }
  }
  return [...new Set(keys)].sort();
}

const proc = Bun.spawnSync(["bunx", "knip", "--reporter", "json"], {
  cwd: ROOT,
  stderr: "inherit",
});
const output = proc.stdout.toString();
let current: string[];
try {
  current = findingKeys((JSON.parse(output) as { issues: KnipIssue[] }).issues);
} catch {
  console.error(
    `knip did not produce JSON (exit ${proc.exitCode}):\n${output}`,
  );
  process.exit(2);
}

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote ${current.length} findings to ${BASELINE_PATH}`);
  process.exit(0);
}

const baseline = new Set(
  JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as string[],
);
const currentSet = new Set(current);
const added = current.filter((key) => !baseline.has(key));
const fixed = [...baseline].filter((key) => !currentSet.has(key));

for (const key of added) console.log(`new finding: ${key}`);
for (const key of fixed) console.log(`fixed, remove from baseline: ${key}`);
if (fixed.length > 0) {
  console.log(
    "Run `bun scripts/knip-baseline.ts --update` to shrink the baseline.",
  );
}
console.log(
  `knip: ${current.length} findings, ${baseline.size} in baseline, ${added.length} new, ${fixed.length} fixed`,
);
process.exit(added.length + fixed.length === 0 ? 0 : 1);
