import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  bootstrapLLMEnv,
  detectLegacyKeyProvider,
} from "../src/env-bootstrap.js";

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

describe("bootstrapLLMEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not copy LLM_API_KEY into provider env vars (#276)", () => {
    process.env.LLM_API_KEY = "sk-ant-test-key-12345";
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not overwrite already set provider keys", () => {
    process.env.ANTHROPIC_API_KEY = "existing-anthropic-key";
    process.env.LLM_API_KEY = "sk-ant-new-key";
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("existing-anthropic-key");
  });
});
