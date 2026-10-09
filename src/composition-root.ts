// src/composition-root.ts — The one place a process turns a database connection into repositories (#169).
//
// Each process (the API server and the worker) opens one connection, runs
// migrations on it once, and passes the `Repositories` bundle down to routes,
// controllers and run commands. Nothing below this module reaches for a
// connection of its own.

import type { Database } from "bun:sqlite";
import { CommandRepository } from "./db/command-repository.js";
import { createDatabase, type DatabaseOptions } from "./db/connection.js";
import { DiagnosticsRepository } from "./db/diagnostics-repository.js";
import { EventRepository } from "./db/event-repository.js";
import { JobRepository } from "./db/job-repository.js";
import { runMigrations } from "./db/migrator.js";
import { OperationLedgerRepository } from "./db/operation-ledger-repository.js";
import { RunRepository } from "./db/run-repository.js";
import { StageAttemptRepository } from "./db/stage-attempt-repository.js";
import { WorkerHeartbeatRepository } from "./db/worker-heartbeat-repository.js";
import type { ProviderRegistry } from "./providers/registry.js";

export interface Repositories {
  db: Database;
  runs: RunRepository;
  jobs: JobRepository;
  events: EventRepository;
  commands: CommandRepository;
  stageAttempts: StageAttemptRepository;
  operationLedger: OperationLedgerRepository;
  diagnostics: DiagnosticsRepository;
  heartbeats: WorkerHeartbeatRepository;
}

/**
 * What the HTTP surface needs from its process: the one repository bundle and,
 * for tests and alternate deployments, a provider registry in place of the
 * built-in one.
 */
export interface ApiContext {
  repos: Repositories;
  providerRegistry?: ProviderRegistry | undefined;
  /**
   * Host/Origin/Content-Type boundary (http/request-guard.ts); defaults to the
   * loopback API. Typed structurally so this module stays free of http imports.
   */
  guard?: { port: number; listenHost: string } | undefined;
}

/**
 * Opens the process's one connection with the production PRAGMAs and migrates
 * it. Both the API server and the worker open their connection here.
 */
export function openProcessDatabase(options?: DatabaseOptions): Database {
  const db = createDatabase(options);
  runMigrations(db);
  return db;
}

/**
 * Builds every repository over one connection. Pure wiring: it neither opens
 * the connection nor runs migrations, so the caller decides both.
 */
export function createRepositories(db: Database): Repositories {
  return {
    db,
    runs: new RunRepository(db),
    jobs: new JobRepository(db),
    events: new EventRepository(db),
    commands: new CommandRepository(db),
    stageAttempts: new StageAttemptRepository(db),
    operationLedger: new OperationLedgerRepository(db),
    diagnostics: new DiagnosticsRepository(db),
    heartbeats: new WorkerHeartbeatRepository(db),
  };
}
