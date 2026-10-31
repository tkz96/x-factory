// scripts/screenshots.ts — One command for before/after screenshots of a screen.
//
//   bun run screenshots runs --label before
//   bun run screenshots all --variant light,dark
//   bun run screenshots --themes
//
// Starts an isolated instance (see screenshots/instance.ts), drives headless
// Chromium through each variant of the evidence matrix and writes
// <out>/<label>/<screen>/<variant>.png. Evidence for review, not a diff gate.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium } from "playwright-core";
import { startIsolatedInstance } from "./screenshots/instance.js";
import {
  parseArgs,
  resolveScreenPath,
  type ScreenshotRequest,
  screenshotPath,
  USAGE,
  UsageError,
  type VariantDef,
} from "./screenshots/matrix.js";

const MAX_HEIGHT = 4000;

async function capture(
  browser: Browser,
  baseUrl: string,
  ids: {
    runId: string;
    projectId: string;
    failedRunId: string;
    reworkedRunId: string;
  },
  request: ScreenshotRequest,
): Promise<string[]> {
  const written: string[] = [];
  for (const variant of request.variants) {
    const context = await browser.newContext({
      viewport: variant.viewport,
      colorScheme: variant.colorScheme,
      reducedMotion: variant.reducedMotion ?? "no-preference",
      forcedColors: variant.forcedColors ?? "none",
      contrast: variant.contrast ?? "no-preference",
    });
    await context.addInitScript(
      ({
        appearance,
        projectId,
      }: {
        appearance: string;
        projectId: string;
      }) => {
        try {
          localStorage.setItem("xf_theme", appearance);
          localStorage.setItem("xf_selected_project", projectId);
        } catch {}
      },
      { appearance: variant.appearance, projectId: ids.projectId },
    );
    const page = await context.newPage();
    for (const screen of request.screens) {
      await page.setViewportSize(variant.viewport);
      await page.goto(`${baseUrl}${resolveScreenPath(screen, ids)}`, {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const file = screenshotPath(request, screen.name, variant.name);
      mkdirSync(path.dirname(file), { recursive: true });
      if (request.fullPage) {
        // Grow the window to the content instead of using Playwright's
        // fullPage, which leaves fixed bars (tab bar, toolbar) mid-page.
        const height = await page.evaluate(() =>
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ),
        );
        await page.setViewportSize({
          width: variant.viewport.width,
          height: Math.min(
            Math.max(height, variant.viewport.height),
            MAX_HEIGHT,
          ),
        });
        await page.waitForTimeout(150);
      }
      await page.screenshot({ path: file });
      written.push(file);
    }
    await context.close();
  }
  return written;
}

function describe(variants: readonly VariantDef[]): string {
  return variants.map((variant) => variant.name).join(", ");
}

async function main(): Promise<number> {
  let request: ScreenshotRequest;
  try {
    request = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
  if (request.help) {
    console.log(USAGE);
    return 0;
  }

  const instance = await startIsolatedInstance({
    publicDir: request.publicDir,
  });
  let browser: Browser | null = null;
  try {
    console.log(
      `Isolated instance at ${instance.url} (data dir ${instance.dataDir})`,
    );
    browser = await chromium.launch();
    const written = await capture(browser, instance.url, instance, request);
    console.log(
      `Captured ${request.screens.map((s) => s.name).join(", ")} in ${describe(request.variants)}:`,
    );
    for (const file of written) console.log(`  ${file}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await browser?.close();
    await instance.stop();
  }
}

process.exit(await main());
