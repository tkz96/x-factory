// scripts/dev.ts — Unified development launcher for X-Factory.
// Spawns: API Server (port 3777), Worker, Vite Frontend (port 5173)

import { type Subprocess, spawn } from "bun";

const procs: Subprocess[] = [];

function launch(_name: string, cmd: string[], _color: string): Subprocess {
  const proc = spawn(cmd, {
    cwd: `${import.meta.dirname}/..`,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  procs.push(proc);
  return proc;
}

console.log("Starting X-Factory development environment...\n");

// 1. API Server (must start first for Vite proxy)
launch("api", ["bun", "--watch", "src/server.ts"], "\x1b[36m");

// 2. Worker
launch("worker", ["bun", "src/worker.ts"], "\x1b[33m");

// 3. Vite Frontend (after a brief delay for the API to bind)
setTimeout(() => {
  launch("vite", ["bun", "run", "dev:frontend"], "\x1b[35m");
}, 500);

// Unified shutdown
const shutdown = () => {
  console.log("\nShutting down all processes...");
  for (const p of procs) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
