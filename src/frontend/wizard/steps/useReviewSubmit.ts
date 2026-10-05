// src/frontend/wizard/steps/useReviewSubmit.ts — the creation mutation and its
// surfaced states (spec #133, #146).
//
// The mutation region contract (#132): `pending` disables the invoking action —
// never a spinner takeover — `success` completes the wizard, and `error`
// renders canonical copy with a working retry. Nothing about the entered form
// state lives here, so a failure can never lose work: the payload is rebuilt
// from the same in-memory state on every attempt.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ProjectCreationPayload } from "../../lib/api-client.js";
import { ApiError, api } from "../../lib/api-client.js";
import { queryKeys } from "../../lib/query-policies.js";
import { clearWizardDraft } from "../storage.js";

export interface ReviewSubmit {
  /** True while the creation request is in flight. */
  isSubmitting: boolean;
  /** The last failure, resolved to copy by the step. */
  error: unknown;
  submit: (payload: ProjectCreationPayload) => void;
}

export function useReviewSubmit(onCreated: () => void): ReviewSubmit {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: ProjectCreationPayload) => api.createProject(payload),
    onSuccess: (project) => {
      // The project appears through the query cache — no full-page reload and
      // no re-entry: the draft is cleared and the wizard closes.
      queryClient.setQueryData<unknown[]>(queryKeys.projects(), (previous) => [
        ...(Array.isArray(previous) ? previous : []),
        project,
      ]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      clearWizardDraft();
      onCreated();
    },
  });

  const submit = useCallback(
    (payload: ProjectCreationPayload) => {
      mutation.mutate(payload);
    },
    [mutation],
  );

  return {
    isSubmitting: mutation.isPending,
    error: mutation.isError ? mutation.error : null,
    submit,
  };
}

/**
 * True when the failure is a semantic 409 whose `formErrors`/`fieldErrors`
 * codes carry the detail (#145). Everything else is a transport-level refusal
 * or a network failure and renders generic canonical copy.
 */
export function isSemanticConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}
