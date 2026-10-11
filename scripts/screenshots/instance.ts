// scripts/screenshots/instance.ts — An isolated X-Factory instance for evidence.
//
// Starts the real API server on a free port with its own temporary data dir and
// projects config, seeded with demo data, and serves a frontend build. It never
// reads or writes ~/.x-factory or config/projects.json, and it runs no worker,
// so nothing executes: every run is a stored record.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  createRepositories,
  openProcessDatabase,
} from "../../src/composition-root.js";
import type { Provider } from "../../src/providers/contract.js";
import { githubProvider } from "../../src/providers/github-module.js";
import { startServer } from "../../src/server.js";
import type { RunStatus } from "../../src/shared/types.js";

const ROOT = path.join(import.meta.dir, "..", "..");
const ENV_KEYS = [
  "X_FACTORY_DATA_DIR",
  "X_FACTORY_CONFIG_PATH",
  "X_FACTORY_DB_PATH",
  "NODE_ENV",
] as const;

export const DEMO_PROJECT_ID = "demo-app";

export interface DemoRun {
  readonly id: string;
  readonly status: RunStatus;
}

export interface IsolatedInstance {
  readonly url: string;
  readonly dataDir: string;
  /** The run that needs the user (a plan is ready), for the run page. */
  readonly runId: string;
  readonly projectId: string;
  readonly runs: readonly DemoRun[];
  stop(): Promise<void>;
}

/** Refuses a data dir that is, or sits inside, the user's real one. */
export function assertIsolatedDataDir(dir: string): void {
  const resolved = path.resolve(dir);
  const real = path.join(homedir(), ".x-factory");
  if (resolved === real || resolved.startsWith(`${real}${path.sep}`)) {
    throw new Error(
      `Refusing to use ${resolved}: it is the real X-Factory data dir.`,
    );
  }
}

const DEMO_TICKETS = [
  ["DEMO-101", "Add dark mode to the settings page", "ready"],
  ["DEMO-102", "Fix the date format on the invoice export", "ready"],
  ["DEMO-103", "Rate-limit the public search endpoint", "ready"],
  ["DEMO-104", "Show build status on the dashboard", "ready"],
  ["DEMO-105", "Cache avatar images for an hour", "ready"],
  ["DEMO-106", "Rename the Teams page to Groups", "ready"],
] as const;

const DEMO_RUNS: ReadonlyArray<{
  key: string;
  title: string;
  status: RunStatus;
  minutesAgo: number;
}> = [
  {
    key: "DEMO-101",
    title: "Add dark mode to the settings page",
    status: "awaiting_plan_approval",
    minutesAgo: 6,
  },
  {
    key: "DEMO-102",
    title: "Fix the date format on the invoice export",
    status: "awaiting_review",
    minutesAgo: 22,
  },
  {
    key: "DEMO-103",
    title: "Rate-limit the public search endpoint",
    status: "executing",
    minutesAgo: 9,
  },
  {
    key: "DEMO-090",
    title: "Upgrade the markdown renderer",
    status: "pr_created",
    minutesAgo: 190,
  },
  {
    key: "DEMO-088",
    title: "Handle empty carts at checkout",
    status: "failed",
    minutesAgo: 400,
  },
  {
    key: "DEMO-085",
    title: "Remove the legacy export button",
    status: "stopped",
    minutesAgo: 1500,
  },
];

const PLAN = `## Plan

1. Add a theme toggle to the Settings page.
2. Store the choice and apply it on load.
3. Cover both appearances with tests.

**Files:** \`src/settings.tsx\`, \`src/theme.ts\``;

const DIFF = `diff --git a/src/theme.ts b/src/theme.ts
--- a/src/theme.ts
+++ b/src/theme.ts
@@ -1,3 +1,6 @@
 export const themes = ["light"];
+export function applyTheme(name: string) {
+  document.documentElement.dataset.theme = name;
+}
`;

function demoTicketProvider(): Provider {
  return {
    ...githubProvider,
    listTickets: async () =>
      DEMO_TICKETS.map(([id, title]) => ({
        id,
        title,
        description: `${title}. Demo ticket for evidence screenshots.`,
        acceptanceCriteria: ["Works in light and dark", "Has a test"],
        labels: ["agentic-workflow"],
        url: `https://example.invalid/${id}`,
        provider: "github" as const,
      })),
  };
}

function seedRuns(dataDir: string): DemoRun[] {
  const repos = createRepositories(openProcessDatabase());
  const created: DemoRun[] = [];
  for (const [index, spec] of DEMO_RUNS.entries()) {
    const id = `demo-run-${index + 1}`;
    const startedAt = new Date(
      Date.now() - spec.minutesAgo * 60_000,
    ).toISOString();
    repos.runs.create({
      id,
      projectId: DEMO_PROJECT_ID,
      projectName: "Demo App",
      ticket: {
        id: spec.key,
        title: spec.title,
        description: `${spec.title}. Demo ticket for evidence screenshots.`,
        acceptanceCriteria: ["Works in light and dark", "Has a test"],
      },
      plan: spec.status === "queued" ? "" : PLAN,
      branch: `xf/${spec.key.toLowerCase()}`,
      status: spec.status,
      startedAt,
      artifactsDir: path.join(dataDir, "artifacts", id),
      worktreePath: path.join(dataDir, "worktrees", id),
    });
    const running = ["executing", "awaiting_review"].includes(spec.status);
    repos.events.appendEvent(id, "info", { text: "Run started." });
    repos.events.appendEvent(id, "chat_agent", {
      text: `I read ${spec.key} and drafted a plan for it.`,
    });
    repos.events.appendEvent(id, "status", { status: spec.status });
    if (running) {
      repos.events.appendEvent(id, "ralph_progress", {
        text: "Writing the change and running tests.",
        iteration: 2,
      });
    }
    if (spec.status === "failed") {
      repos.events.appendEvent(id, "error", {
        message: "Tests still failed after 3 repair attempts.",
      });
    }
    if (spec.status === "awaiting_review" || spec.status === "pr_created") {
      repos.runs.update(id, { diff: DIFF });
    }
    if (spec.status === "pr_created") {
      repos.runs.update(id, {
        finishedAt: new Date().toISOString(),
        pullRequest: {
          url: "https://example.invalid/pull/12",
          branch: `xf/${spec.key.toLowerCase()}`,
          baseBranch: "main",
          title: spec.title,
        },
      });
      repos.events.appendEvent(id, "pr_merged", {
        url: "https://example.invalid/pull/12",
        mergedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        mergedBy: "octocat",
      });
    }
    created.push({ id, status: spec.status });
  }
  return created;
}

/** Builds the frontend into `outDir` with Vite and returns it. */
export function buildFrontend(outDir: string): string {
  const build = spawnSync(
    "bun",
    [
      "x",
      "vite",
      "build",
      "--outDir",
      outDir,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  if (build.status !== 0) throw new Error("The frontend build failed.");
  return outDir;
}

/**
 * Starts the instance. `publicDir` is a built frontend; when omitted one is
 * built into the temporary dir. The caller must `stop()` it.
 */
export async function startIsolatedInstance(
  options: { publicDir?: string | null } = {},
): Promise<IsolatedInstance> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "xf-shots-")));
  const dataDir = path.join(root, "data");
  assertIsolatedDataDir(dataDir);
  mkdirSync(dataDir, { recursive: true });

  const saved = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const restoreEnv = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  let server: ReturnType<typeof startServer> | null = null;
  try {
    const configPath = path.join(root, "projects.json");
    const workspace = path.join(root, "demo-app");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        projects: [
          {
            id: DEMO_PROJECT_ID,
            name: "Demo App",
            workspacePath: workspace,
            issueTracker: { provider: "github" },
            repositories: [
              {
                id: "demo-app-primary",
                name: "Demo App",
                path: workspace,
                defaultBranch: "main",
                role: "other",
              },
            ],
          },
        ],
      }),
    );
    process.env.X_FACTORY_DATA_DIR = dataDir;
    process.env.X_FACTORY_CONFIG_PATH = configPath;
    delete process.env.X_FACTORY_DB_PATH;

    const publicDir =
      options.publicDir ?? buildFrontend(path.join(root, "public"));
    if (!existsSync(path.join(publicDir, "index.html"))) {
      throw new Error(
        `No frontend build in ${publicDir}: index.html is missing.`,
      );
    }

    const db = openProcessDatabase();
    const runs = seedRuns(dataDir);
    const registry = new Map([["github", demoTicketProvider()]]);
    // Port 0 asks the OS for a free port, so 3777 and 5173 are never touched.
    server = startServer(0, publicDir, db, registry);
    const running = server;
    const runId = (runs.find(
      (run) => run.status === "awaiting_plan_approval",
    ) ?? runs[0]) as DemoRun;

    return {
      url: `http://127.0.0.1:${running.port}`,
      dataDir,
      runId: runId.id,
      projectId: DEMO_PROJECT_ID,
      runs,
      async stop() {
        running.stop(true);
        db.close();
        restoreEnv();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (err) {
    server?.stop(true);
    restoreEnv();
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}
