// src/shared/model-key.ts — The one key a model is known by: its connection and model id (#281).
// The gateway queue, the per-call count and the daily cost all join on it.

export function modelKey(connectionId: string, modelId: string): string {
  return `${connectionId}:${modelId}`;
}
