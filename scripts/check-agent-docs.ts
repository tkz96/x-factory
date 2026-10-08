// scripts/check-agent-docs.ts — Keeps AGENTS.md and docs/agents/ honest.
//
// Fails when:
//   - a relative Markdown link points at a file that does not exist
//   - a docs/agents/*.md file is not linked from AGENTS.md
//   - `bun run <script>` names a script missing from package.json
//   - an inline-code repository path (src/…, docs/…, scripts/…) does not exist
//   - a required symlink to the single entry point is missing or wrong
//   - the Reticle-managed block is back in AGENTS.md (see docs/agents/reticle.md)
//
// Usage:
//   bun scripts/check-agent-docs.ts   exit 1 on any problem

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const ENTRY = "AGENTS.md";
const AGENT_DOCS_DIR = "docs/agents";

// Each tool-specific entry file is a symlink, so there is one physical copy.
const SYMLINKS: Record<string, string> = {
  "CLAUDE.md": "AGENTS.md",
  "GEMINI.md": "AGENTS.md",
  ".claude/skills": "../.agents/skills",
};

const PATH_PREFIXES = [
  "src/",
  "docs/",
  "scripts/",
  "test/",
  ".agents/",
  ".claude/",
  ".github/",
  "public/",
];
const PLACEHOLDER = /[<>*{}$]/;

const problems: string[] = [];
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const agentDocs = readdirSync(path.join(ROOT, AGENT_DOCS_DIR))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `${AGENT_DOCS_DIR}/${name}`);
const scripts = Object.keys(
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
    .scripts,
);

function linkTargets(file: string, text: string): string[] {
  const targets: string[] = [];
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) continue;
    const target = path.normalize(
      path.join(path.dirname(file), href.split("#")[0]),
    );
    targets.push(target.replace(/\/$/, ""));
  }
  return targets;
}

function inlinePaths(text: string): string[] {
  const found: string[] = [];
  for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
    for (const token of code.split(/\s+/)) {
      const candidate = token
        .replace(/[,.;:)]+$/, "")
        .replace(/^["(]/, "")
        .replace(/"$/, "");
      if (!PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
        continue;
      if (PLACEHOLDER.test(candidate)) continue;
      found.push(candidate.replace(/\/$/, ""));
    }
  }
  return found;
}

for (const file of [ENTRY, ...agentDocs]) {
  const text = read(file);
  for (const target of linkTargets(file, text)) {
    if (!existsSync(path.join(ROOT, target)))
      problems.push(`${file}: broken link to ${target}`);
  }
  for (const [, script] of text.matchAll(/bun run ([\w:.-]+)/g)) {
    if (!scripts.includes(script))
      problems.push(
        `${file}: \`bun run ${script}\` is not a package.json script`,
      );
  }
  for (const repoPath of inlinePaths(text)) {
    if (!existsSync(path.join(ROOT, repoPath)))
      problems.push(`${file}: path \`${repoPath}\` does not exist`);
  }
}

const linkedFromEntry = new Set(linkTargets(ENTRY, read(ENTRY)));
for (const doc of agentDocs) {
  if (!linkedFromEntry.has(doc))
    problems.push(`${ENTRY}: does not link ${doc}`);
}

for (const [link, expected] of Object.entries(SYMLINKS)) {
  const full = path.join(ROOT, link);
  if (!existsSync(full) && !lstatSync(full, { throwIfNoEntry: false })) {
    problems.push(`${link}: missing, expected a symlink to ${expected}`);
  } else if (!lstatSync(full).isSymbolicLink()) {
    problems.push(
      `${link}: is a regular file or directory, expected a symlink to ${expected}`,
    );
  } else if (readlinkSync(full) !== expected) {
    problems.push(
      `${link}: points to ${readlinkSync(full)}, expected ${expected}`,
    );
  } else if (!existsSync(full)) {
    problems.push(`${link}: symlink target ${expected} does not exist`);
  }
}

if (read(ENTRY).includes("reticle:begin")) {
  problems.push(
    `${ENTRY}: contains the Reticle-managed block; remove it (see docs/agents/reticle.md)`,
  );
}

for (const problem of problems) console.log(`✗ ${problem}`);
console.log(
  problems.length === 0
    ? `Agent docs OK: ${ENTRY} + ${agentDocs.length} docs, ${Object.keys(SYMLINKS).length} symlinks`
    : `${problems.length} agent-doc problem(s)`,
);
process.exit(problems.length === 0 ? 0 : 1);
