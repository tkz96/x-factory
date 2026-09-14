// src/http/settings-controller.ts — Global workbench settings configuration endpoints.

import { loadSettings, saveSettings, type FactorySettings } from "../settings.js";
import { jsonResponse, errorResponse, parseJsonBody } from "./responses.js";

async function handleGetSettings(): Promise<Response> {
  const settings = await loadSettings(true);
  return jsonResponse(settings);
}

async function handleUpdateSettings(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for settings.");
  }
  const updated = await saveSettings(body as Partial<FactorySettings>);
  return jsonResponse(updated);
}

export function handleSettingsRoute(method: string, req: Request): Promise<Response> | null {
  if (method === "GET") return handleGetSettings();
  if (method === "POST") return handleUpdateSettings(req);
  return null;
}
