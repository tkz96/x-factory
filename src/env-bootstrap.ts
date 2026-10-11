// src/env-bootstrap.ts — Resolve LLM_API_KEY into provider-specific environment variables.

export type LegacyKeyProvider = "anthropic" | "gemini" | "openai";

/**
 * Which provider a legacy `LLM_API_KEY` belongs to: `LLM_PROVIDER` when set,
 * else the key's prefix. Google issues both `AIzaSy…` and newer `AQ.…` keys
 * (#276). Returns undefined when neither says.
 */
export function detectLegacyKeyProvider(
  key: string,
  providerHint?: string,
): LegacyKeyProvider | undefined {
  const hint = providerHint?.trim().toLowerCase();
  if (hint === "anthropic" || hint === "gemini" || hint === "openai") {
    return hint;
  }
  if (hint === "google") return "gemini";
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("AIzaSy") || key.startsWith("AQ.")) return "gemini";
  if (key.startsWith("sk-")) return "openai";
  return undefined;
}

export function bootstrapLLMEnv(): void {
  const key = process.env.LLM_API_KEY?.trim();
  if (!key) return;

  const targetProvider =
    detectLegacyKeyProvider(key, process.env.LLM_PROVIDER) ?? "anthropic";

  if (targetProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = key;
  } else if (targetProvider === "gemini" && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = key;
  } else if (targetProvider === "openai" && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = key;
  }
}
