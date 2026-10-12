// test/run-models-card-layout.test.tsx — The run page's Models card in a real
// layout engine. happy-dom lays nothing out, so Chromium renders the card's
// markup with its stylesheet and the test measures it: the stage, model and
// usage columns line up across rows, and at phone width the usage sits under
// the model instead of crushing it to a character per line.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { RunModelsCard } from "../src/frontend/components/runs/RunModelsCard.js";
import type { StageModelUse } from "../src/shared/types.js";

const FRONTEND = path.join(import.meta.dir, "../src/frontend");
const css = (file: string) => readFileSync(path.join(FRONTEND, file), "utf8");

const USE: StageModelUse = {
  role: "builder",
  connectionId: "c1",
  connectionName: "Gemini (imported)",
  apiType: "gemini",
  modelId: "gemini-3.8-flash",
  stage: "understand",
  attempt: 1,
  startedAt: "2026-10-11T10:00:00.000Z",
  tokensIn: 52_700,
  tokensOut: 1_900,
  costUsd: 0.047,
};

const MODELS: StageModelUse[] = [
  USE,
  { ...USE, attempt: 2, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  {
    ...USE,
    stage: "plan",
    tokensIn: undefined,
    tokensOut: undefined,
    costUsd: undefined,
  },
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function renderCard(width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const markup = renderToStaticMarkup(<RunModelsCard stageModels={MODELS} />);
  await page.setContent(
    `<!doctype html><html><head><style>${css("styles/tokens.css")}${css(
      "components/runs/RunModelsCard.css",
    )}</style></head><body>${markup}</body></html>`,
  );
  return page;
}

interface Box {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.$$eval(selector, (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom, width: r.width };
    }),
  );
}

describe("the Models card lays out in columns", () => {
  test("on a desktop the model and usage columns line up across rows", async () => {
    const page = await renderCard(800);
    const models = await boxes(page, ".run-models-model");
    const usages = await boxes(page, ".run-models-usage");
    expect(models).toHaveLength(3);
    const lefts = new Set(models.map((b) => Math.round(b.left)));
    expect(lefts.size).toBe(1);
    const usageRights = usages.map((b) => Math.round(b.left + b.width));
    expect(new Set(usageRights).size).toBe(1);
    await page.close();
  }, 60_000);

  test("at phone width the model reads on a line and the usage sits under it", async () => {
    const page = await renderCard(390);
    const [model] = await boxes(page, ".run-models-model");
    const [usage] = await boxes(page, ".run-models-usage");
    if (!model || !usage) throw new Error("the card rendered no rows");
    // "gemini-3.8-flash" fits on one line rather than wrapping a character at a time.
    const lineHeight = await page.$eval(
      ".run-models-model",
      (el) =>
        Number.parseFloat(getComputedStyle(el).lineHeight) ||
        Number.parseFloat(getComputedStyle(el).fontSize) * 1.5,
    );
    expect(model.width).toBeGreaterThan(120);
    expect(model.bottom - model.top).toBeLessThan(lineHeight * 3);
    expect(usage.top).toBeGreaterThanOrEqual(model.bottom - 1);
    await page.close();
  }, 60_000);
});
