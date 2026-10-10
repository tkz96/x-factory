// src/http/settings-controller.ts — Global workbench settings configuration endpoints.

import { loadSettings, saveSettings } from "../settings.js";
import type { WorkbenchSettings } from "../shared/types.js";
import { jsonResponse, withValidatedBody } from "./responses.js";
import {
  type WorkbenchSettingsBody,
  WorkbenchSettingsSchema,
} from "./schemas.js";

export async function handleGetSettings(): Promise<Response> {
  const settings: WorkbenchSettings = await loadSettings(true);
  return jsonResponse(settings);
}

export async function handleUpdateSettings(req: Request): Promise<Response> {
  return withValidatedBody<WorkbenchSettingsBody>(
    req,
    WorkbenchSettingsSchema,
    async (body) => {
      const updated: WorkbenchSettings = await saveSettings(body);
      return jsonResponse(updated);
    },
    "Invalid JSON for settings.",
  );
}
