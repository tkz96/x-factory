// src/frontend/components/palette/palette-items.ts — What the command palette can reach (#254).
//
// Pure: the palette feeds in the loaded projects and runs and gets back the list
// it shows, filtered by the query. Matching is on label, detail and keywords, so a
// run is found by its ticket key or its title.

import type { Project, Run } from "../../../shared/types.js";

export type PaletteGroup =
  | "Actions"
  | "Sections"
  | "Projects"
  | "Runs"
  | "Help";

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string | undefined;
  keywords: string;
  /** A route inside the app, or an external URL opened in a new tab. */
  target?: { kind: "route"; path: string } | { kind: "external"; url: string };
  /** An action with no route, such as opening a dialog. */
  action?: "start-run" | "add-project" | "stop-run" | "shortcuts";
}

export const SECTION_ITEMS: PaletteItem[] = [
  {
    id: "section-queue",
    group: "Sections",
    label: "Work Queue",
    keywords: "tickets queue",
    target: { kind: "route", path: "/queue" },
  },
  {
    id: "section-runs",
    group: "Sections",
    label: "Active Runs",
    keywords: "runs running",
    target: { kind: "route", path: "/runs" },
  },
  {
    id: "section-history",
    group: "Sections",
    label: "History",
    keywords: "audit past",
    target: { kind: "route", path: "/history" },
  },
  {
    id: "section-projects",
    group: "Sections",
    label: "Projects",
    keywords: "repositories workspace",
    target: { kind: "route", path: "/projects" },
  },
];

export const HELP_ITEMS: PaletteItem[] = [
  {
    id: "help-docs",
    group: "Help",
    label: "Documentation",
    keywords: "help docs guide",
    target: { kind: "external", url: "/docs" },
  },
  {
    id: "help-reference",
    group: "Help",
    label: "API Reference",
    keywords: "help api reference scalar",
    target: { kind: "external", url: "/reference" },
  },
  {
    id: "help-shortcuts",
    group: "Help",
    label: "Keyboard Shortcuts",
    keywords: "help keys shortcuts ?",
    action: "shortcuts",
  },
];

export interface PaletteSources {
  projects: Pick<Project, "id" | "name">[];
  runs: Run[];
  /** Present on a run page where the run can be stopped. */
  stopRunAvailable: boolean;
}

export function buildPaletteItems(sources: PaletteSources): PaletteItem[] {
  const actions: PaletteItem[] = [
    {
      id: "action-start-run",
      group: "Actions",
      label: "Start Run",
      keywords: "new run ticket implement",
      action: "start-run",
    },
    {
      id: "action-add-project",
      group: "Actions",
      label: "Add Project",
      keywords: "onboard project repository connect",
      action: "add-project",
    },
    {
      id: "action-open-settings",
      group: "Actions",
      label: "Open Settings",
      keywords: "preferences credentials models",
      target: { kind: "route", path: "/settings" },
    },
  ];
  if (sources.stopRunAvailable) {
    actions.push({
      id: "action-stop-run",
      group: "Actions",
      label: "Stop Run",
      keywords: "cancel halt abort",
      action: "stop-run",
    });
  }

  const projects: PaletteItem[] = sources.projects.map((p) => ({
    id: `project-${p.id}`,
    group: "Projects",
    label: p.name,
    detail: "Project",
    keywords: p.id,
    target: { kind: "route", path: `/projects/${p.id}` },
  }));

  const runs: PaletteItem[] = sources.runs.map((run) => ({
    id: `run-${run.id}`,
    group: "Runs",
    label: `${run.ticket.id} ${run.ticket.title}`,
    detail: `${run.project.name} · ${run.status}`,
    keywords: `${run.ticket.id} ${run.id} ${run.branch}`,
    target: { kind: "route", path: `/runs/${run.id}` },
  }));

  return [...actions, ...SECTION_ITEMS, ...projects, ...runs, ...HELP_ITEMS];
}

/** Items whose label, detail or keywords contain every word of the query. */
export function filterPaletteItems(
  items: PaletteItem[],
  query: string,
): PaletteItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const haystack =
      `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
