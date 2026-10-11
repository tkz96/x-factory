// src/http/model-connections-controller.ts — CRUD for X-Factory-owned model
// connections (#276). Responses never carry an API key: only whether one is
// set and its last four characters.

import type { Repositories } from "../composition-root.js";
import {
  addConnectionModel,
  checkModelConnection,
  createModelConnection,
  deleteModelConnection,
  getModelConnection,
  listModelConnections,
  type ModelConnectionView,
  removeConnectionModel,
  updateConnectionModel,
  updateModelConnection,
} from "../model-connections.js";
import { errorResponse, jsonResponse, withValidatedBody } from "./responses.js";
import {
  type AddConnectionModelBody,
  AddConnectionModelBodySchema,
  type CreateModelConnectionBody,
  CreateModelConnectionBodySchema,
  type UpdateConnectionModelBody,
  UpdateConnectionModelBodySchema,
  type UpdateModelConnectionBody,
  UpdateModelConnectionBodySchema,
} from "./schemas.js";

function attachTodayUsage(
  connections: ModelConnectionView[],
  repos?: Repositories,
): ModelConnectionView[] {
  if (!repos) return connections;
  const usageMap = repos.stageAttempts.getDailyUsageByModel();
  for (const connection of connections) {
    for (const model of connection.models) {
      const usage = usageMap.get(`${connection.id}:${model.modelId}`);
      model.todayUsage = {
        usd: usage?.costUsd ?? usage?.spendUsd ?? 0,
        requests: usage?.requests ?? 0,
      };
    }
  }
  return connections;
}

export async function handleListModelConnections(
  repos?: Repositories,
): Promise<Response> {
  const connections = await listModelConnections();
  return jsonResponse(attachTodayUsage(connections, repos));
}

export async function handleGetModelConnection(
  id: string,
  repos?: Repositories,
): Promise<Response> {
  const connection = await getModelConnection(id);
  return connection
    ? jsonResponse(attachTodayUsage([connection], repos)[0])
    : errorResponse(`Model connection "${id}" not found.`, 404);
}

export async function handleCreateModelConnection(
  req: Request,
): Promise<Response> {
  return withValidatedBody<CreateModelConnectionBody>(
    req,
    CreateModelConnectionBodySchema,
    async (body) => jsonResponse(await createModelConnection(body), 201),
    "Invalid JSON for model connection.",
  );
}

export async function handleUpdateModelConnection(
  id: string,
  req: Request,
): Promise<Response> {
  return withValidatedBody<UpdateModelConnectionBody>(
    req,
    UpdateModelConnectionBodySchema,
    async (body) => jsonResponse(await updateModelConnection(id, body)),
    "Invalid JSON for model connection.",
  );
}

export async function handleDeleteModelConnection(
  id: string,
): Promise<Response> {
  await deleteModelConnection(id);
  return jsonResponse({ ok: true });
}

export async function handleCheckModelConnection(
  id: string,
): Promise<Response> {
  return jsonResponse(await checkModelConnection(id));
}

export async function handleAddConnectionModel(
  id: string,
  req: Request,
): Promise<Response> {
  return withValidatedBody<AddConnectionModelBody>(
    req,
    AddConnectionModelBodySchema,
    async (body) =>
      jsonResponse(await addConnectionModel(id, body.modelId), 201),
    "Invalid JSON for model.",
  );
}

/** Model IDs can contain slashes (OpenRouter), so they travel as `?modelId=`. */
function modelIdFrom(url: URL): string | undefined {
  return url.searchParams.get("modelId")?.trim() || undefined;
}

export async function handleUpdateConnectionModel(
  id: string,
  req: Request,
  url: URL,
): Promise<Response> {
  const modelId = modelIdFrom(url);
  if (!modelId)
    return errorResponse("The modelId query parameter is required.", 400);
  return withValidatedBody<UpdateConnectionModelBody>(
    req,
    UpdateConnectionModelBodySchema,
    async (body) =>
      jsonResponse(await updateConnectionModel(id, modelId, body)),
    "Invalid JSON for model.",
  );
}

export async function handleRemoveConnectionModel(
  id: string,
  url: URL,
): Promise<Response> {
  const modelId = modelIdFrom(url);
  if (!modelId)
    return errorResponse("The modelId query parameter is required.", 400);
  await removeConnectionModel(id, modelId);
  return jsonResponse({ ok: true });
}
