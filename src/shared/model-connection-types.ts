// src/shared/model-connection-types.ts — Types for model connections shared by
// the server and the UI (#276, #277). No runtime code: the UI imports these
// without pulling in the server's file-system modules.

export const MODEL_API_TYPES = [
  "openai-compatible",
  "gemini",
  "anthropic",
] as const;
export type ModelApiType = (typeof MODEL_API_TYPES)[number];

/** Details X-Factory keeps per model; every field is optional and editable. */
export interface ModelDetails {
  contextWindow?: number | undefined;
  maxOutputTokens?: number | undefined;
  inputPricePerMTok?: number | undefined;
  outputPricePerMTok?: number | undefined;
}

export interface DiscoveredModel extends ModelDetails {
  id: string;
  name?: string | undefined;
}

export type CheckErrorCategory =
  | "key_rejected"
  | "unreachable"
  | "rate_limited"
  | "other";

export interface CheckError {
  category: CheckErrorCategory;
  message: string;
  status?: number | undefined;
  retryAfterSeconds?: number | undefined;
}

export type ModelListResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; error: CheckError };

export interface ModelLimits {
  rpm?: number | undefined;
  tpm?: number | undefined;
  rpd?: number | undefined;
  tpd?: number | undefined;
}

export interface ModelBudget {
  perDay: { usd?: number | undefined; requests?: number | undefined };
}

/** A model chosen from a connection, with its (editable) details. */
export interface ModelRecord extends ModelDetails {
  modelId: string;
  name?: string | undefined;
  limits: ModelLimits;
  budget: ModelBudget;
  /** Today's recorded usage for this model in UTC (#281). */
  todayUsage?: { usd: number; requests: number } | undefined;
}

/** Edits to a model record; `null` clears a detail. */
export interface ModelRecordPatch {
  contextWindow?: number | null | undefined;
  maxOutputTokens?: number | null | undefined;
  inputPricePerMTok?: number | null | undefined;
  outputPricePerMTok?: number | null | undefined;
  limits?: ModelLimits | undefined;
  budget?: ModelBudget | undefined;
}

/** A connection as returned by the API: never the key itself. */
export interface ModelConnectionView {
  id: string;
  name: string;
  apiType: ModelApiType;
  baseUrl: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  models: ModelRecord[];
  availableModels: DiscoveredModel[];
  hasKey: boolean;
  keyLast4: string | null;
  /** Where the effective key comes from. */
  keySource: "stored" | "environment" | "none";
}
