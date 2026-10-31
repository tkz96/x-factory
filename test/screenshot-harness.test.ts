// test/screenshot-harness.test.ts — The screenshot harness (#246): its matrix,
// its argument parsing, and the isolation of the instance it starts. The
// browser itself is not driven here; the tests prove what it would be pointed at.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  assertIsolatedDataDir,
  type IsolatedInstance,
  startIsolatedInstance,
} from "../scripts/screenshots/instance.js";
import {
  parseArgs,
  resolveScreenPath,
  SCREENS,
  screenshotPath,
  UsageError,
  VARIANTS,
} from "../scripts/screenshots/matrix.js";
import {
  createRepositories,
  openProcessDatabase,
} from "../src/composition-root.js";

describe("evidence matrix", () => {
  test("covers light, dark, 390 px, increased contrast, reduced motion and forced colours", () => {
    const byName = Object.fromEntries(VARIANTS.map((v) => [v.name, v]));
    expect(byName.light?.colorScheme).toBe("light");
    expect(byName.dark?.colorScheme).toBe("dark");
    expect(byName.narrow?.viewport.width).toBe(390);
    expect(byName.contrast?.contrast).toBe("more");
    expect(byName.motion?.reducedMotion).toBe("reduce");
    expect(byName["forced-colors"]?.forcedColors).toBe("active");
  });

  test("names every screen of the app once", () => {
    const names = SCREENS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const wanted of [
      "welcome",
      "shell",
      "runs",
      "run",
      "projects",
      "settings",
      "docs",
      "reference",
    ]) {
      expect(names).toContain(wanted);
    }
  });
});

describe("parseArgs", () => {
  test("a named screen is captured in every variant by default", () => {
    const request = parseArgs(["runs"]);
    expect(request.screens.map((s) => s.name)).toEqual(["runs"]);
    expect(request.variants).toHaveLength(VARIANTS.length);
    expect(request.label).toBe("current");
  });

  test("`all` selects every screen and --variant narrows the conditions", () => {
    const request = parseArgs([
      "all",
      "--variant",
      "light,dark",
      "--label",
      "before",
    ]);
    expect(request.screens).toHaveLength(SCREENS.length);
    expect(request.variants.map((v) => v.name)).toEqual(["light", "dark"]);
    expect(request.label).toBe("before");
  });

  test("--themes captures only the shell, once per theme", () => {
    const request = parseArgs(["--themes"]);
    expect(request.screens.map((s) => s.name)).toEqual(["shell"]);
    expect(request.variants.map((v) => v.name)).toEqual([
      "theme-light",
      "theme-dark",
    ]);
  });

  test("unknown screens, variants, options and missing screens are usage errors", () => {
    expect(() => parseArgs(["nope"])).toThrow(UsageError);
    expect(() => parseArgs(["runs", "--variant", "sepia"])).toThrow(UsageError);
    expect(() => parseArgs(["runs", "--bogus"])).toThrow(UsageError);
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(["runs", "--label", "../x"])).toThrow(UsageError);
  });

  test("paths are <out>/<label>/<screen>/<variant>.png and ids fill in", () => {
    const request = parseArgs([
      "run",
      "--out",
      "/tmp/shots",
      "--label",
      "after",
    ]);
    expect(screenshotPath(request, "run", "dark")).toBe(
      "/tmp/shots/after/run/dark.png",
    );
    const run = SCREENS.find((s) => s.name === "run");
    expect(
      run &&
        resolveScreenPath(run, {
          runId: "r1",
          projectId: "p1",
          failedRunId: "f1",
          reworkedRunId: "w1",
        }),
    ).toBe("/runs/r1");
    const failed = SCREENS.find((s) => s.name === "run-failed");
    expect(
      failed &&
        resolveScreenPath(failed, {
          runId: "r1",
          projectId: "p1",
          failedRunId: "f1",
          reworkedRunId: "w1",
        }),
    ).toBe("/runs/f1");
    const reworked = SCREENS.find((s) => s.name === "run-reworked");
    expect(
      reworked &&
        resolveScreenPath(reworked, {
          runId: "r1",
          projectId: "p1",
          failedRunId: "f1",
          reworkedRunId: "w1",
        }),
    ).toBe("/runs/w1");
  });
});

describe("isolated instance", () => {
  let instance: IsolatedInstance | null = null;
  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  function fakeBuild(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "xf-shots-test-public-"));
    writeFileSync(
      path.join(dir, "index.html"),
      "<!doctype html><title>x</title>",
    );
    return dir;
  }

  test("refuses the real data dir", () => {
    expect(() =>
      assertIsolatedDataDir(path.join(homedir(), ".x-factory")),
    ).toThrow();
    expect(() =>
      assertIsolatedDataDir(path.join(homedir(), ".x-factory", "x")),
    ).toThrow();
  });

  test("runs on its own port, temp data dir and config, with seeded demo data", async () => {
    const before = {
      data: process.env.X_FACTORY_DATA_DIR,
      config: process.env.X_FACTORY_CONFIG_PATH,
    };
    instance = await startIsolatedInstance({ publicDir: fakeBuild() });
    const port = Number(new URL(instance.url).port);
    expect([3777, 5173]).not.toContain(port);
    expect(
      instance.dataDir.startsWith(`${homedir() + path.sep}.x-factory`),
    ).toBe(false);
    expect(process.env.X_FACTORY_DATA_DIR).toBe(instance.dataDir);
    expect(existsSync(path.join(instance.dataDir, "x-factory.db"))).toBe(true);

    const runs = (await (
      await fetch(`${instance.url}/api/runs`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(runs.length).toBe(instance.runs.length);
    expect(runs.some((r) => r.status === "awaiting_plan_approval")).toBe(true);

    // The failed run's status event carries a failure cause, for the terminal card.
    const failedRun = runs.find((r) => r.id === instance?.failedRunId);
    expect(failedRun?.status).toBe("failed");
    const failedStatus = createRepositories(openProcessDatabase())
      .events.getEventsForRun(instance.failedRunId)
      .find((e) => e.type === "status");
    const payload = failedStatus?.payload as
      | { failure?: { category?: string } }
      | undefined;
    expect(payload?.failure?.category).toBe("verification");

    // The reworked run walked back from review: two attempts.
    const reworkedStatuses = createRepositories(openProcessDatabase())
      .events.getEventsForRun(instance.reworkedRunId)
      .filter((e) => e.type === "status")
      .map((e) => (e.payload as { status?: string }).status);
    expect(reworkedStatuses).toEqual([
      "awaiting_review",
      "executing",
      "awaiting_review",
    ]);

    const tickets = (await (
      await fetch(`${instance.url}/api/projects/${instance.projectId}/tickets`)
    ).json()) as unknown[];
    expect(tickets.length).toBeGreaterThan(0);

    const dataDir = instance.dataDir;
    await instance.stop();
    instance = null;
    expect(existsSync(dataDir)).toBe(false);
    expect(process.env.X_FACTORY_DATA_DIR).toBe(before.data);
    expect(process.env.X_FACTORY_CONFIG_PATH).toBe(before.config);
  });

  test("fails clearly when there is no frontend build to serve", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "xf-shots-test-empty-"));
    await expect(startIsolatedInstance({ publicDir: empty })).rejects.toThrow(
      /index\.html/,
    );
  });
});
