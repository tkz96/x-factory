// src/frontend/wizard/steps/connection-error-helpers.ts — Helpers for error extraction and status derivation.

import type { VerificationResult } from "../../connection/types.js";
import { ApiError } from "../../lib/api-client.js";

export function deriveVerificationStatus(
  isPending: boolean,
  verification: VerificationResult | null,
  error: unknown,
): "idle" | "pending" | "ok" | "degraded" | "error" {
  if (isPending) return "pending";
  if (verification?.status === "ok") return "ok";
  if (verification?.status === "degraded") return "degraded";
  if (error) return "error";
  return "idle";
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return typeof val === "object" && val !== null
    ? (val as Record<string, unknown>)
    : null;
}

export function extractApiErrors(error: unknown): {
  fieldErrors: Record<string, string> | null;
  formErrors: string[] | null;
} {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return { fieldErrors: null, formErrors: null };
  }
  const data = asRecord(error.data);
  const fieldErrors = asRecord(data?.fieldErrors) as Record<
    string,
    string
  > | null;
  const formErrors = Array.isArray(data?.formErrors)
    ? (data.formErrors as string[])
    : null;
  return { fieldErrors, formErrors };
}
