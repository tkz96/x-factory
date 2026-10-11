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
  | "key rejected"
  | "rate limited"
  | "context too large"
  | "budget reached";

/** A model call that can't happen: the role or its model/key isn't usable. */
export class ModelUnavailableError extends DomainError {
  readonly category: ModelFailureCategory;
  constructor(
    message: string,
    category: ModelFailureCategory = "model unavailable",
  ) {
    super(message);
    this.category = category;
  }
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
