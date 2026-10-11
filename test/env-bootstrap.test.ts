// test/env-bootstrap.test.ts — Which provider a legacy LLM_API_KEY belongs to (#276).

import { describe, expect, it } from "bun:test";
import { detectLegacyKeyProvider } from "../src/env-bootstrap.js";

describe("detectLegacyKeyProvider", () => {
  it("detects Anthropic from sk-ant- prefix", () => {
    expect(detectLegacyKeyProvider("sk-ant-test-key-12345")).toBe("anthropic");
  });

  it("detects Gemini from AIzaSy prefix", () => {
    expect(detectLegacyKeyProvider("AIzaSyTestGeminiKey")).toBe("gemini");
  });

  it("detects Gemini from Google's newer AQ. prefix (#276)", () => {
    expect(detectLegacyKeyProvider("AQ.test-google-key-12345")).toBe("gemini");
  });

  it("treats LLM_PROVIDER=google as Gemini (#276)", () => {
    expect(detectLegacyKeyProvider("opaque-key-12345", "google")).toBe(
      "gemini",
    );
  });

  it("detects OpenAI from sk- prefix", () => {
    expect(detectLegacyKeyProvider("sk-proj-test-openai-key")).toBe("openai");
  });

  it("respects explicit LLM_PROVIDER override for gemini", () => {
    expect(detectLegacyKeyProvider("custom-key", "gemini")).toBe("gemini");
  });

  it("respects explicit LLM_PROVIDER override for openai", () => {
    expect(detectLegacyKeyProvider("custom-key", "openai")).toBe("openai");
  });

  it("returns undefined for unrecognized keys without explicit provider", () => {
    expect(detectLegacyKeyProvider("unrecognized-key-format")).toBeUndefined();
  });
});
