// test/specimen-route.test.ts — the dev-only specimen route (spec #292, step 2,
// #294). The route must exist in a development build and must leave no trace in
// the production bundle.

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { specimenRoute } from "../src/frontend/dev-routes.js";
import { routeDefinitions } from "../src/frontend/routes.js";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const BUILD_TIMEOUT_MS = 180_000;

/** Builds the frontend into a fresh directory with the given NODE_ENV. */
function buildInto(nodeEnv: "production" | "development"): string {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `xf-specimen-${nodeEnv}-`),
  );
  const result = spawnSync(
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
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: nodeEnv },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`vite build failed: ${result.stderr || result.stdout}`);
  }
  return outDir;
}

/** Concatenates every built script, so a marker is found wherever it landed. */
function readScripts(dir: string): string {
  const assets = path.join(dir, "assets");
  return fs
    .readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(assets, name), "utf8"))
    .join("\n");
}

const SPECIMEN_MARKERS = ["__specimen", "SpecimenView", "specimen-title"];

describe("the specimen route", () => {
  it("is addressed at /__specimen when it is built", () => {
    expect(specimenRoute().path).toBe("__specimen");
  });

  it("is not declared outside development", () => {
    // bun test runs without import.meta.env.DEV, which is the production shape.
    const paths = routeDefinitions.flatMap((route) =>
      (route.children ?? []).map((child) => child.path),
    );
    expect(paths).not.toContain("__specimen");
  });

  it(
    "leaves no specimen code in the production bundle",
    () => {
      const dir = buildInto("production");
      try {
        const scripts = readScripts(dir);
        for (const marker of SPECIMEN_MARKERS) {
          expect(scripts.includes(marker)).toBe(false);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "ships the specimen route in a development build",
    () => {
      const dir = buildInto("development");
      try {
        expect(readScripts(dir).includes("__specimen")).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS,
  );
});
