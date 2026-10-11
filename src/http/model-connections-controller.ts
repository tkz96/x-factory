// src/http/model-connections-controller.ts — CRUD for X-Factory-owned model
// connections (#276). Responses never carry an API key: only whether one is
// set and its last four characters.

import {
  createModelConnection,
  deleteModelConnection,
  getModelConnection,
  listModelConnections,
  updateModelConnection,
} from "../model-connections.js";
import { errorResponse, jsonResponse, withValidatedBody } from "./responses.js";
import {
  type CreateModelConnectionBody,
  CreateModelConnectionBodySchema,
  type UpdateModelConnectionBody,
  UpdateModelConnectionBodySchema,
} from "./schemas.js";

export async function handleListModelConnections(): Promise<Response> {
  return jsonResponse(await listModelConnections());
}

export async function handleGetModelConnection(id: string): Promise<Response> {
  const connection = await getModelConnection(id);
  return connection
    ? jsonResponse(connection)
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
