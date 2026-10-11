// src/frontend/components/projects/ProjectsSplit.tsx — THE Projects split
// (#267, spec #241): the list and the detail side by side, the way Mail shows
// mailboxes and messages. The detail pushes over the list at phone width, where
// the back link in the pane header returns to it.
//
// Both routes render this one component, so the list is the same list whether
// or not a project is selected — the URL, not a copy of the state, says which
// project the detail shows.

import "./ProjectsSplit.css";

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PROJECTS_COPY } from "../feedback/copy-map.js";
import { ProjectList } from "./ProjectList.js";

export interface ProjectsSplitProps {
  /** The project the URL names, when it names one. */
  selectedId?: string | undefined;
  /** The detail pane's content; omitted on the list-only route. */
  children?: ReactNode | undefined;
}

export function ProjectsSplit({ selectedId, children }: ProjectsSplitProps) {
  return (
    <section
      id="area-projects"
      className="projects-split"
      data-detail={selectedId === undefined ? "list" : "project"}
    >
      <ProjectList selectedId={selectedId} />

      <div className="projects-detail-pane">
        <Link to="/projects" className="projects-detail-back">
          <svg className="icon icon-sm" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-arrow-left" />
          </svg>
          <span>{PROJECTS_COPY.backToList}</span>
        </Link>
        {children ?? (
          <p className="projects-detail-prompt">{PROJECTS_COPY.selectPrompt}</p>
        )}
      </div>
    </section>
  );
}
