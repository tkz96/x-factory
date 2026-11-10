// src/frontend/components/projects/BaseBranchPicker.tsx — The base branch of one
// repository: shown pre-set, changed from the provider's branch list
// (read only when the user asks), or typed when the list cannot be read.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { QUERY_POLICIES } from "../../lib/query-policies.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { REPOSITORIES_COPY } from "../feedback/copy-map.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { Button } from "../ui/Button.js";
import "./BaseBranchPicker.css";

interface BaseBranchPickerProps {
  repositoryId: string;
  /** The branch in effect: the user's choice or the stored/provider default. */
  branch: string;
  onChange: (branch: string) => void;
  /** Identifies the listing in the query cache. */
  queryKey: readonly unknown[];
  /** Reads the repository's branch names; called only once the user opens it. */
  loadBranches: () => Promise<string[]>;
}

export function BaseBranchPicker({
  repositoryId: id,
  branch,
  onChange,
  queryKey,
  loadBranches,
}: BaseBranchPickerProps) {
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey,
    enabled: open,
    queryFn: loadBranches,
    ...QUERY_POLICIES.providerBranches,
  });

  const derived = deriveAsyncState({
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
  });
  const branches = query.data ?? [];
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
