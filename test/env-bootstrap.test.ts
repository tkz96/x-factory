// test/env-bootstrap.test.ts — Unit tests for LLM_API_KEY auto-detection and resolution.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bootstrapLLMEnv } from "../src/env-bootstrap.js";

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

  it("does nothing when LLM_API_KEY is not set", () => {
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("detects Anthropic from sk-ant- prefix", () => {
    process.env.LLM_API_KEY = "sk-ant-test-key-12345";
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-key-12345");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("detects Gemini from AIzaSy prefix", () => {
    process.env.LLM_API_KEY = "AIzaSyTestGeminiKey";
    bootstrapLLMEnv();
    expect(process.env.GEMINI_API_KEY).toBe("AIzaSyTestGeminiKey");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("detects OpenAI from sk- prefix", () => {
    process.env.LLM_API_KEY = "sk-proj-test-openai-key";
    bootstrapLLMEnv();
    expect(process.env.OPENAI_API_KEY).toBe("sk-proj-test-openai-key");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("respects explicit LLM_PROVIDER override for gemini", () => {
    process.env.LLM_API_KEY = "custom-key";
    process.env.LLM_PROVIDER = "gemini";
    bootstrapLLMEnv();
    expect(process.env.GEMINI_API_KEY).toBe("custom-key");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("respects explicit LLM_PROVIDER override for openai", () => {
    process.env.LLM_API_KEY = "custom-key";
    process.env.LLM_PROVIDER = "openai";
    bootstrapLLMEnv();
    expect(process.env.OPENAI_API_KEY).toBe("custom-key");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("falls back to Anthropic for unrecognized keys without explicit provider", () => {
    process.env.LLM_API_KEY = "unrecognized-key-format";
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("unrecognized-key-format");
  });

  it("does not overwrite already set provider keys", () => {
    process.env.ANTHROPIC_API_KEY = "existing-anthropic-key";
    process.env.LLM_API_KEY = "sk-ant-new-key";
    bootstrapLLMEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("existing-anthropic-key");
  });
});
