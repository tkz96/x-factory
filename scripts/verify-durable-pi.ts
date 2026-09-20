// scripts/verify-durable-pi.ts — Automated verification of Milestone 1 final objective:
// HTTP / SQLite run -> SQLite durable job -> Independent Bun worker -> Real Pi process/session.

import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { getDatabasePath } from "../src/paths.js";

async function main() {
  console.log(
    "================================================================================",
  );
  console.log(
    "X-FACTORY: DURABLE JOB TO REAL PI PROCESS VERIFICATION (XFM-25C)",
  );
  console.log(
    "================================================================================\n",
  );

  const db = createDatabase({ path: getDatabasePath() });
  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const stageAttemptRepo = new StageAttemptRepository(db);
  const eventRepo = new EventRepository(db);

  const runId = `smoke-pi-${Date.now()}`;
  console.log(
    `[1] Creating SQLite Run and durable Job in stage 'pi_checkpoint' (run_id: ${runId})...`,
  );

  const run = runRepo.create({
    id: runId,
    projectId: "converso",
    projectName: "Converso",
    ticket: {
      id: "PI-CHECKPOINT-1",
      title: "Real Pi Integration Checkpoint",
      acceptanceCriteria: [
        "Worker claims job",
        "Real Pi session executes prompt",
      ],
    },
    plan: "Verify real Pi session starts from durable job",
    branch: `factory/pi-checkpoint-${runId}`,
    status: "preparing",
    artifactsDir: `/tmp/artifacts-${runId}`,
    worktreePath: `/tmp/worktrees-${runId}`,
  });

  const job = jobRepo.createJob({
    runId: run.id,
    stage: "pi_checkpoint",
    status: "pending",
  });

  console.log(`    ✓ SQLite Run created (status: ${run.status})`);
  console.log(
    `    ✓ Durable Job created (id: ${job.id}, stage: ${job.stage}, status: ${job.status})\n`,
  );

  console.log(
    "[2] Spawning independent Bun worker process (`bun src/worker.ts`)...",
  );
  const workerProc = Bun.spawn(["bun", "src/worker.ts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  console.log(
    `    ✓ Independent worker process spawned with PID: ${workerProc.pid}`,
  );

  // Stream logs from worker process
  const reader = workerProc.stdout.getReader();
  const decoder = new TextDecoder();

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        process.stdout.write(`    [Worker PID ${workerProc.pid}] ${text}`);
      }
    } catch {
      // Reader closed
    }
  })();

  // Poll database for job completion
  console.log(
    "\n[3] Waiting for independent worker to claim job and start real Pi session...",
  );
  const startTime = Date.now();
  let completed = false;

  while (Date.now() - startTime < 30000) {
    const currentJob = jobRepo.getJob(job.id);
    if (currentJob?.status === "completed") {
      completed = true;
      break;
    }
    await Bun.sleep(500);
  }

  // Gracefully terminate worker
  console.log("\n[4] Shutting down worker process with SIGINT...");
  workerProc.kill("SIGINT");
  await Promise.race([workerProc.exited, Bun.sleep(3000)]);
  try {
    workerProc.kill("SIGKILL");
  } catch {}

  console.log("\n[5] Verifying database final audit trail:");
  const finalJob = jobRepo.getJob(job.id);
  console.log("    - Final Job State:", finalJob);

  const attempts = stageAttemptRepo.listForRun(run.id);
  console.log(`    - Stage Attempts count: ${attempts.length}`);
  if (attempts.length > 0) {
    console.log("    - Stage Attempt:", {
      id: attempts[0]?.id,
      stage: attempts[0]?.stage,
      status: attempts[0]?.status,
      startedAt: attempts[0]?.startedAt,
      finishedAt: attempts[0]?.finishedAt,
      output: attempts[0]?.output,
    });
  }

  const events = eventRepo.getEventsForRun(run.id);
  console.log(`    - Durable Events recorded in SQLite: ${events.length}`);
  for (const ev of events) {
    console.log(
      `      * [${ev.type}] ${ev.payload ? JSON.stringify(ev.payload) : ""}`,
    );
  }

  if (
    completed &&
    finalJob?.status === "completed" &&
    attempts[0]?.status === "completed"
  ) {
    console.log(
      "\n================================================================================",
    );
    console.log(
      "SUCCESS: Real Pi process/session started from durable SQLite job by independent worker!",
    );
    console.log(
      "================================================================================",
    );
    process.exit(0);
  } else {
    console.error("\nFAILED: Worker did not complete the job within timeout.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification script failed:", err);
  process.exit(1);
});
