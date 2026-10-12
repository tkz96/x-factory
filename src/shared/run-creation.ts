// src/shared/run-creation.ts — The one wire contract for a refused run creation
// (#255): `POST /api/runs` answers 409 with this envelope when the ticket
// already has an active run, and the client opens `runId` instead of starting a
// second one. Shared so the server's response and the client's check cannot
// drift apart.

/** The machine-readable code a refused run creation carries. */
export const ACTIVE_RUN_CONFLICT_CODE = "RUN_ALREADY_ACTIVE";

/**
 * Body of the 409 `POST /api/runs` answers when the ticket already has an
 * active run. `runId` is the active run to open.
 */
export interface CreateRunConflictResponse {
  error: string;
  code: typeof ACTIVE_RUN_CONFLICT_CODE;
  runId: string;
}

/** Narrows an unknown response body to the refused-creation envelope. */
export function isCreateRunConflict(
  data: unknown,
): data is CreateRunConflictResponse {
  if (!data || typeof data !== "object") return false;
  const body = data as { code?: unknown; runId?: unknown };
  return (
    body.code === ACTIVE_RUN_CONFLICT_CODE && typeof body.runId === "string"
  );
}
