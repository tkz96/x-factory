// src/model-roles.ts — Resolves the Builder and Reviewer roles to everything a
// model call needs (#278): the connection, the model, the API key and the
// model's details. A role that can't resolve fails with a clear reason and a
// pointer to Settings › Models — there is never a fallback to another model.

import { DomainError } from "./errors.js";
import {
  runtimeCatalogDetails,
  runtimeCatalogReasoning,
} from "./model-catalog.js";
import {
  getModelConnection,
  resolveModelConnectionKey,
} from "./model-connections.js";
import { loadSettings } from "./settings.js";
import type {
  ModelApiType,
  ModelBudget,
  ModelDetails,
  ModelLimits,
} from "./shared/model-connection-types.js";
import type { ModelRoleName, ModelUsage, ModelUse } from "./shared/types.js";

export type ModelFailureCategory =
  | "model unavailable"
  | "model not found"
  | "key rejected"
  | "rate limited"
  | "quota exhausted"
  | "context too large"
  | "budget reached";

export interface ModelFailureDetail {
  /** The provider's own error text, for diagnostics only; never shown as copy. */
  raw?: string | undefined;
  /** How long the provider asked to wait, when it said (a used-up quota). */
  retryAfterMs?: number | undefined;
}

/** A model call that can't happen: the role or its model/key isn't usable. */
export class ModelUnavailableError extends DomainError {
  readonly category: ModelFailureCategory;
  readonly raw: string | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(
    message: string,
    category: ModelFailureCategory = "model unavailable",
    detail: ModelFailureDetail = {},
  ) {
    super(message);
    this.category = category;
    this.raw = detail.raw;
    this.retryAfterMs = detail.retryAfterMs;
  }
}

/**
 * Failures that the same call would hit again at once: a model the provider does not
 * offer, a rejected key, a used-up quota, a prompt too large for the window. Retrying the
 * stage only repeats the request, so the stage fails without a retry.
 */
const NOT_RETRYABLE: ReadonlySet<ModelFailureCategory> = new Set([
  "model not found",
  "key rejected",
  "quota exhausted",
  "context too large",
]);

export function isRetryableModelFailure(err: ModelUnavailableError): boolean {
  return !NOT_RETRYABLE.has(err.category);
}

export function isBudgetReached(
  err: unknown,
): err is ModelUnavailableError & { category: "budget reached" } {
  return (
    err instanceof ModelUnavailableError && err.category === "budget reached"
  );
}

export interface ResolvedModel {
  role: ModelRoleName;
  connectionId: string;
  connectionName: string;
  apiType: ModelApiType;
  baseUrl: string;
  modelId: string;
  /** Server-side only; never sent to a client or written to disk. */
  apiKey: string;
  details: ModelDetails & { reasoning?: boolean | undefined };
  /** The model's rate limits as recorded on its connection (#280). */
  limits: ModelLimits;
  /** The model's daily budget (#281). */
  budget: ModelBudget;
}

const ROLE_LABELS: Readonly<Record<ModelRoleName, string>> = {
  builder: "Builder",
  reviewer: "Reviewer",
};

const FIX_HINT = "Choose a model in Settings › Models.";

export async function resolveRole(role: ModelRoleName): Promise<ResolvedModel> {
  const label = ROLE_LABELS[role];
  const assignment = (await loadSettings()).roles?.[role];
  if (!assignment) {
    throw new ModelUnavailableError(`${label} has no model. ${FIX_HINT}`);
  }
  const connection = await getModelConnection(assignment.connectionId);
  if (!connection) {
    throw new ModelUnavailableError(
      `${label}'s connection no longer exists. ${FIX_HINT}`,
    );
  }
  if (!connection.verifiedAt) {
    throw new ModelUnavailableError(
      `${label}'s connection "${connection.name}" has not been checked. Use Check Connection in Settings › Models.`,
    );
  }
  const apiKey = await resolveModelConnectionKey(connection.id);
  if (!apiKey) {
    throw new ModelUnavailableError(
      `${label}'s connection "${connection.name}" has no API key. Add one in Settings › Models.`,
    );
  }
  const { modelId } = assignment;
  if (
    connection.availableModels.length > 0 &&
    !connection.availableModels.some((m) => m.id === modelId)
  ) {
    throw new ModelUnavailableError(
      `${label}'s model "${modelId}" is not available on connection "${connection.name}". ${FIX_HINT}`,
      "model unavailable",
    );
  }
  const record = connection.models.find((m) => m.modelId === modelId);
  const catalog = runtimeCatalogDetails(
    connection.apiType,
    connection.baseUrl,
    modelId,
  );
  const pick = <K extends keyof ModelDetails>(key: K) =>
    record?.[key] ?? catalog?.[key];
  return {
    role,
    connectionId: connection.id,
    connectionName: connection.name,
    apiType: connection.apiType,
    baseUrl: connection.baseUrl,
    modelId,
    apiKey,
    details: {
      contextWindow: pick("contextWindow"),
      maxOutputTokens: pick("maxOutputTokens"),
      inputPricePerMTok: pick("inputPricePerMTok"),
      outputPricePerMTok: pick("outputPricePerMTok"),
      reasoning: runtimeCatalogReasoning(
        connection.apiType,
        connection.baseUrl,
        modelId,
      ),
    },
    limits: record?.limits ?? {},
    budget: record?.budget ?? { perDay: {} },
  };
}

/** Throws one ModelUnavailableError naming every role that can't resolve. */
export async function assertRolesReady(): Promise<void> {
  const problems: string[] = [];
  for (const role of ["builder", "reviewer"] as const) {
    try {
      await resolveRole(role);
    } catch (err: unknown) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      problems.push(err.message);
    }
  }
  if (problems.length > 0) {
    throw new ModelUnavailableError(problems.join(" "));
  }
}

const CATEGORY_LABELS: Readonly<Record<ModelFailureCategory, string>> = {
  "model unavailable": "Model unavailable",
  "model not found": "Model not available",
  "key rejected": "Key rejected",
  "rate limited": "Rate limited",
  "quota exhausted": "Quota used up",
  "context too large": "Context too large",
  "budget reached": "Budget reached",
};

/**
 * The reason a stage reports for a model it could not use (#282): the failure
 * category in plain words, then the message that says how to fix it.
 */
export function modelFailureReason(err: ModelUnavailableError): string {
  const label = CATEGORY_LABELS[err.category] ?? "Model unavailable";
  if (err.message.toLowerCase().startsWith(`${label.toLowerCase()}:`)) {
    return err.message;
  }
  if (err.message.startsWith(label)) {
    return err.message;
  }
  return `${label}: ${err.message}`;
}

/** The record of which model did some work, as it is now (#279). */
export function modelUse(resolved: ResolvedModel): ModelUse {
  return {
    role: resolved.role,
    connectionId: resolved.connectionId,
    connectionName: resolved.connectionName,
    apiType: resolved.apiType,
    modelId: resolved.modelId,
  };
}

/**
 * Usage with a cost: the provider's own cost when it reported one, otherwise
 * computed from the model's prices per million tokens (#279).
 */
export function usageWithCost(
  resolved: ResolvedModel,
  usage: {
    tokensIn?: number | undefined;
    tokensOut?: number | undefined;
    costUsd?: number | undefined;
  },
): ModelUsage {
  const { inputPricePerMTok, outputPricePerMTok } = resolved.details;
  const priced =
    usage.costUsd === undefined &&
    (inputPricePerMTok !== undefined || outputPricePerMTok !== undefined)
      ? ((usage.tokensIn ?? 0) * (inputPricePerMTok ?? 0) +
          (usage.tokensOut ?? 0) * (outputPricePerMTok ?? 0)) /
        1_000_000
      : usage.costUsd;
  const result: ModelUsage = {};
  if (usage.tokensIn !== undefined) result.tokensIn = usage.tokensIn;
  if (usage.tokensOut !== undefined) result.tokensOut = usage.tokensOut;
  if (priced !== undefined) result.costUsd = priced;
  return result;
}
