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
  // Deprecated: LLM_API_KEY is now imported as a model connection by
  // importLegacyModelKey (#276), so we no longer copy it into provider vars.
}
