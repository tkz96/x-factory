// src/frontend/connection/format-field-error.ts — Field error message formatter.

import { resolveFieldValidationError } from "../components/feedback/copy-map.js";

export function formatFieldError(code: string, fieldLabel: string): string {
  return resolveFieldValidationError(code, fieldLabel);
}
