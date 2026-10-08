// scripts/check-all.ts — Runs every quality gate in docs/agents/ci-checks.md and prints one line per gate.
//
// Static gates are read-only and run in parallel; test suites run one at a time.
// Full logs go to a temp directory; only a failing gate's log tail is printed.
//
// Usage:
//   bun run check:all        exit 1 if any gate fails

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

interface Gate {
  name: string;
  cmd: string[];
}

const STATIC_GATES: Gate[] = [
  { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
  { name: "typecheck:frontend", cmd: ["bun", "run", "typecheck:frontend"] },
  { name: "lint", cmd: ["bun", "run", "lint"] },
  { name: "check:fallow", cmd: ["bun", "run", "check:fallow"] },
  { name: "check:cycles", cmd: ["bun", "run", "check:cycles"] },
  { name: "check:knip", cmd: ["bun", "run", "check:knip"] },
  { name: "docs:schema:check", cmd: ["bun", "run", "docs:schema:check"] },
  { name: "check:agent-docs", cmd: ["bun", "run", "check:agent-docs"] },
];

const TEST_GATES: Gate[] = [
  { name: "test (coverage)", cmd: ["bun", "test", "--coverage"] },
  { name: "test:frontend-smoke", cmd: ["bun", "run", "test:frontend-smoke"] },
  { name: "test:integration", cmd: ["bun", "run", "test:integration"] },
  {
    name: "test:integration:production",
    cmd: ["bun", "run", "test:integration:production"],
  },
];

const TAIL_LINES = 15;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

interface GateResult {
  gate: Gate;
  exitCode: number;
  seconds: number;
  logPath: string;
  output: string;
}

async function runGate(gate: Gate, logDir: string): Promise<GateResult> {
  const start = performance.now();
  const proc = Bun.spawn(gate.cmd, {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}${stderr}`.replace(ANSI, "");
  const logPath = path.join(
    logDir,
    `${gate.name.replace(/[^\w-]+/g, "_")}.log`,
  );
  await writeFile(logPath, output);
  return {
    gate,
    exitCode,
    seconds: (performance.now() - start) / 1000,
    logPath,
    output,
  };
}

function report(result: GateResult): void {
  const time = `${result.seconds.toFixed(1)}s`;
  if (result.exitCode === 0) {
    console.log(`✓ ${result.gate.name} (${time})`);
    return;
  }
  console.log(
    `✗ ${result.gate.name} (exit ${result.exitCode}, ${time}) — ${result.logPath}`,
  );
  const tail = result.output.trimEnd().split("\n").slice(-TAIL_LINES);
  for (const line of tail) console.log(`    ${line}`);
}

const logDir = await mkdtemp(path.join(tmpdir(), "x-factory-check-all-"));
const results: GateResult[] = [];

for (const result of await Promise.all(
  STATIC_GATES.map((gate) => runGate(gate, logDir)),
)) {
  report(result);
  results.push(result);
}
for (const gate of TEST_GATES) {
  const result = await runGate(gate, logDir);
  report(result);
  results.push(result);
}

const failed = results.filter((r) => r.exitCode !== 0);
console.log(
  failed.length === 0
    ? `All ${results.length} gates passed. Logs: ${logDir}`
    : `${failed.length}/${results.length} gates failed. Logs: ${logDir}`,
);
process.exit(failed.length === 0 ? 0 : 1);
