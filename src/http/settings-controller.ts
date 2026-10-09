// src/http/settings-controller.ts — Global workbench settings configuration endpoints.

import { loadSettings, saveSettings } from "../settings.js";
import type {
  SettingsUpdateRequest,
  WorkbenchSettings,
} from "../shared/types.js";
import { jsonResponse, withJsonBody } from "./responses.js";

async function handleGetSettings(): Promise<Response> {
  const settings: WorkbenchSettings = await loadSettings(true);
  return jsonResponse(settings);
}

async function handleUpdateSettings(req: Request): Promise<Response> {
  return withJsonBody<SettingsUpdateRequest>(
    req,
    async (body) => {
      const updated: WorkbenchSettings = await saveSettings(body);
      return jsonResponse(updated);
    },
    "Invalid JSON for settings.",
  );
}

export function handleSettingsRoute(
  method: string,
  req: Request,
): Promise<Response> | null {
  if (method === "GET") return handleGetSettings();
  if (method === "POST") return handleUpdateSettings(req);
  return null;
}
