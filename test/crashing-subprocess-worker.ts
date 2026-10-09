import { createDatabase } from "../src/db/connection.js";
import type { StageOutcome } from "../src/executors/index.js";
import { Worker } from "../src/worker.js";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("No database path provided");
  process.exit(1);
}

const db = createDatabase({ path: dbPath });

const worker = new Worker({
  workerId: "worker-subprocess-crasher",
  db,
  commandLeaseDurationMs: 150,
  deliverExecutor: {
    async execute(): Promise<StageOutcome> {
      console.log("EXECUTOR_STARTED");
      await new Promise(() => {}); // hang forever
      return { outcome: "passed", output: { prUrl: "url" } };
    },
  },
});

worker.stepCommandOnce().catch(console.error);
