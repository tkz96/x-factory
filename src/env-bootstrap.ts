// src/env-bootstrap.ts — Resolve LLM_API_KEY into provider-specific environment variables.

export function bootstrapLLMEnv(): void {
  const key = process.env.LLM_API_KEY?.trim();
  if (!key) return;

  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();

  let targetProvider: "anthropic" | "gemini" | "openai" = "anthropic";
  if (provider === "anthropic" || (!provider && key.startsWith("sk-ant-"))) {
    targetProvider = "anthropic";
  } else if (provider === "gemini" || (!provider && key.startsWith("AIzaSy"))) {
    targetProvider = "gemini";
  } else if (provider === "openai" || (!provider && key.startsWith("sk-"))) {
    targetProvider = "openai";
  }

  if (targetProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = key;
  } else if (targetProvider === "gemini" && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = key;
  } else if (targetProvider === "openai" && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = key;
  }
}
