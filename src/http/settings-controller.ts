// src/http/settings-controller.ts — Global workbench settings configuration endpoints.

import { loadSettings, saveSettings } from "../settings.js";
import type {
  SettingsUpdateRequest,
  WorkbenchSettings,
} from "../shared/types.js";
import { jsonResponse, withJsonBody } from "./responses.js";

export async function handleGetSettings(): Promise<Response> {
  const settings: WorkbenchSettings = await loadSettings(true);
  return jsonResponse(settings);
}

export async function handleUpdateSettings(req: Request): Promise<Response> {
  return withJsonBody<SettingsUpdateRequest>(
    req,
    async (body) => {
      const updated: WorkbenchSettings = await saveSettings(body);
      return jsonResponse(updated);
    },
    "Invalid JSON for settings.",
  );
}
