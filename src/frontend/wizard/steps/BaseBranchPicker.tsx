// src/frontend/wizard/steps/BaseBranchPicker.tsx — The base branch of one
// selected repository: shown pre-set, changed from the provider's branch list
// (read only when the user asks), or typed when the list cannot be read.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import {
  isNormalizedError,
  REPOSITORIES_COPY,
} from "../../components/feedback/copy-map.js";
import { deriveAsyncState } from "../../components/feedback/derive-async-state.js";
import { Button } from "../../components/ui/Button.js";
import type {
  BranchesEnvelope,
  ProviderDescriptor,
} from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";

interface BaseBranchPickerProps {
  repository: { id: string; name: string; remote: string };
  /** The branch in effect: the user's choice or the provider's default. */
  branch: string;
  onChange: (branch: string) => void;
  providerId: string | null;
  config: Record<string, unknown>;
  descriptor: ProviderDescriptor | undefined;
}

export function BaseBranchPicker({
  repository,
  branch,
  onChange,
  providerId,
  config,
  descriptor,
}: BaseBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const id = repository.id;

  const query = useQuery({
    queryKey: queryKeys.providerBranches(providerId, config, id, descriptor),
    enabled: open && providerId !== null,
    queryFn: async (): Promise<BranchesEnvelope> => {
      if (providerId === null) {
        throw new Error("Listing branches requires a git-host connection.");
      }
      const envelope = await api.providers.listBranches({
        providerId,
        role: "gitHost",
        config,
        repository: {
          id,
          name: repository.name,
          remote: repository.remote,
        },
      });
      if (isNormalizedError(envelope)) throw envelope;
      return envelope;
    },
    ...QUERY_POLICIES.providerBranches,
  });

  const derived = deriveAsyncState({
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
  });
  const branches = query.data?.branches ?? [];
  // The branch in effect stays choosable even when the list omits it.
  const options = branches.includes(branch) ? branches : [branch, ...branches];

  return (
    <div className="repositories-base-branch" id={`repo-base-branch-${id}`}>
      <span className="repositories-base-branch-label text-subhead">
        {REPOSITORIES_COPY.baseBranchLabel}
      </span>
      <code className="repositories-base-branch-value text-footnote">
        {branch}
      </code>
      <Button
        id={`btn-base-branch-change-${id}`}
        variant="secondary"
        size="sm"
        onPress={() => setOpen((v) => !v)}
      >
        {open
          ? REPOSITORIES_COPY.baseBranchDone
          : REPOSITORIES_COPY.baseBranchChange}
      </Button>
      {open && (
        <div className="repositories-base-branch-choice">
          <AsyncRegion
            derived={derived}
            onRetry={() => {
              void query.refetch();
            }}
          >
            <select
              id={`base-branch-select-${id}`}
              className="form-select"
              aria-label={REPOSITORIES_COPY.baseBranchSelectLabel}
              value={branch}
              onChange={(e) => onChange(e.target.value)}
            >
              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </AsyncRegion>
          {query.isError && (
            <input
              id={`base-branch-input-${id}`}
              className="form-input text-callout"
              aria-label={REPOSITORIES_COPY.baseBranchTypeLabel}
              placeholder={REPOSITORIES_COPY.baseBranchListFailed}
              value={branch}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}
