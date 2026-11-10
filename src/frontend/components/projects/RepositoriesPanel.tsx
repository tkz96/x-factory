// src/frontend/components/projects/RepositoriesPanel.tsx — The Repositories tab
// of the project pane: a filterable list of the project's repositories on the
// left and the one form of the selected repository on the right. The selection
// is the caller's (the URL), so a reload or a link keeps it.

import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import type { ProjectRepository } from "../../../shared/types.js";
import {
  PROJECT_DETAIL_COPY,
  REPOSITORY_SETTINGS_COPY,
} from "../feedback/copy-map.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Icon } from "../ui/Icon.js";
import { TextField } from "../ui/TextField.js";
import "./RepositoriesPanel.css";
import { RepositorySettings } from "./RepositorySettings.js";

interface RepositoriesPanelProps {
  projectId: string;
  repositories: readonly ProjectRepository[];
  /** The selected repository's id; one that matches none shows the first. */
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function RepositoriesPanel({
  projectId,
  repositories,
  selectedId,
  onSelect,
}: RepositoriesPanelProps) {
  const [filter, setFilter] = useState("");

  if (repositories.length === 0) {
    return (
      <div id="project-detail-repos-table">
        <EmptyState
          icon="icon-folder"
          message={PROJECT_DETAIL_COPY.repositoriesEmpty}
        />
      </div>
    );
  }

  const selected =
    repositories.find((r) => r.id === selectedId) ?? repositories[0];
  const needle = filter.trim().toLowerCase();
  const shown = repositories.filter((r) =>
    r.name.toLowerCase().includes(needle),
  );

  return (
    <section className="repo-panel">
      <div className="repo-panel-split">
        <div className="repo-panel-list">
          <TextField
            label={REPOSITORY_SETTINGS_COPY.filterLabel}
            hideLabel
            placeholder={REPOSITORY_SETTINGS_COPY.filterPlaceholder}
            value={filter}
            onChange={setFilter}
            className="repo-panel-filter"
          />
          {shown.length === 0 ? (
            <p className="repo-panel-none text-subhead">
              {REPOSITORY_SETTINGS_COPY.noMatches}
            </p>
          ) : (
            <ul
              className="repo-panel-items"
              aria-label={REPOSITORY_SETTINGS_COPY.listLabel}
            >
              {shown.map((r) => (
                <li key={r.id}>
                  <AriaButton
                    className="repo-panel-item"
                    aria-current={r.id === selected?.id}
                    onPress={() => onSelect(r.id)}
                  >
                    <span className="repo-panel-name text-body">{r.name}</span>
                    <span className="repo-panel-branch text-footnote">
                      <Icon name="icon-git-branch" size="xs" />
                      {r.defaultBranch}
                    </span>
                  </AriaButton>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected !== undefined && (
          <div className="repo-panel-form">
            <RepositorySettings
              key={selected.id}
              projectId={projectId}
              repository={selected}
              repositories={repositories}
              isPrimary={selected.id === repositories[0]?.id}
            />
          </div>
        )}
      </div>
    </section>
  );
}
