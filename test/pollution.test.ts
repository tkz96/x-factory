// test/pollution.test.ts — Unit tests for pollution patterns and workspace baseline guardrails.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { isPollutionPath, POLLUTION_PATTERNS } from "../src/pollution.js";

describe("Pollution Patterns & Guardrails", () => {
  it("exports defined pollution patterns", () => {
    assert.ok(Array.isArray(POLLUTION_PATTERNS));
    assert.ok(POLLUTION_PATTERNS.length > 0);
  });

  it("identifies forbidden generated files as pollution", () => {
    assert.equal(isPollutionPath(".env"), true);
    assert.equal(isPollutionPath(".env.local"), true);
    assert.equal(isPollutionPath(".env.production.local"), true);
    assert.equal(isPollutionPath("server.log"), true);
    assert.equal(isPollutionPath("logs/app.log"), true);
    assert.equal(isPollutionPath("tmp/scratch.txt"), true);
    assert.equal(isPollutionPath(".temp/data.json"), true);
    assert.equal(isPollutionPath(".cache/build.bin"), true);
  });

  it("allows safe configuration and source files", () => {
    assert.equal(isPollutionPath(".env.example"), false);
    assert.equal(isPollutionPath(".env.template"), false);
    assert.equal(isPollutionPath("src/index.ts"), false);
    assert.equal(isPollutionPath("package.json"), false);
    assert.equal(isPollutionPath("README.md"), false);
    assert.equal(isPollutionPath("public/styles.css"), false);
  });
});
