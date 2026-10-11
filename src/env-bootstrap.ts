// src/env-bootstrap.ts — Which provider a legacy LLM_API_KEY belongs to (#276).
// It is imported as a model connection (importLegacyModelKey), never copied into
// provider environment variables, so there is nothing to bootstrap at startup.

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
