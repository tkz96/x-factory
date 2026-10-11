import "./AppShell.css";
import "./AppShellDocsPhone.css";

import { type UIEvent, useEffect, useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { STOPPABLE_RUN_STATUSES } from "../../shared/run-status-policy.js";
import type { Project } from "../../shared/types.js";
import { ModalProvider, useModal } from "../context/ModalContext.js";
import {
  ProjectProvider,
  useCurrentProject,
} from "../context/ProjectContext.js";
import {
  useReadiness,
  useRun,
  useSaveSettings,
  useSettings,
  useStopRun,
} from "../hooks/useQueries.js";
import { resolveInitialTheme, setTheme, useTheme } from "../hooks/useTheme.js";
import {
  formatShortcut,
  getShortcut,
  isMacPlatform,
} from "../shortcuts/registry.js";
import { useGlobalShortcuts } from "../shortcuts/useGlobalShortcuts.js";
import { DocsSidebarNav } from "./docs/DocsSidebarNav.js";
import { ModalContainer } from "./ModalContainer.js";
import { CommandPalette } from "./palette/CommandPalette.js";
import { ShortcutSheet } from "./palette/ShortcutSheet.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";

/** Scrolling past this many pixels moves the page title into the toolbar. */
const COMPACT_TITLE_SCROLL = 32;

/** The three workbench sections, in toolbar and tab-bar order (#258). */
const SECTIONS = [
  { id: "tickets", label: "Tickets", icon: "icon-layers" },
  { id: "runs", label: "Runs", icon: "icon-play" },
  { id: "projects", label: "Projects", icon: "icon-folder" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The section a path belongs to, or "" on Settings and Docs. */
function sectionFor(pathname: string): SectionId | "" {
  if (pathname.startsWith("/tickets")) return "tickets";
  if (pathname.startsWith("/runs")) return "runs";
  if (pathname.startsWith("/projects")) return "projects";
  return "";
}

function getActiveTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/runs/")) {
    return {
      title: "Run",
      subtitle: "What the run is doing and what it needs from you",
    };
  }
  if (pathname.startsWith("/projects/")) {
    return {
      title: "Project",
      subtitle: "Repository and issue tracker for this project",
    };
  }
  switch (pathname) {
    case "/runs":
      return {
        title: "Runs",
        subtitle: "Runs that are working or waiting for you",
      };
    case "/projects":
      return {
        title: "Projects",
        subtitle: "Repositories and issue trackers",
      };
    case "/settings":
      return {
        title: "Settings",
        subtitle: "Models, connections, appearance and diagnostics",
      };
    default:
      return {
        title: "Tickets",
        subtitle: "Pick a ticket to start a run",
      };
  }
}

interface ThemeToggleButtonProps {
  id: string;
  className: string;
  onToggle: () => void;
}

export function ThemeToggleButton({
  id,
  className,
  onToggle,
}: ThemeToggleButtonProps) {
  return (
    <button
      id={id}
      className={className}
      aria-label="Toggle Dark and Light Mode"
      title="Toggle theme"
      type="button"
      onClick={onToggle}
    >
      <span className="theme-icon sun-icon">
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-sun" />
        </svg>
      </span>
      <span className="theme-icon moon-icon">
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-moon" />
        </svg>
      </span>
    </button>
  );
}

const SECTIONS_LABEL = "Sections";

interface DocsSidebarProps {
  docsNavOpen: boolean;
  onCloseDocsNav: () => void;
  onToggleTheme: () => void;
}

/** The Docs document list. It is the Docs screen's own navigation, not the app's. */
function DocsSidebar({
  docsNavOpen,
  onCloseDocsNav,
  onToggleTheme,
}: DocsSidebarProps) {
  return (
    <aside
      id="app-sidebar"
      className={`sidebar${docsNavOpen ? " docs-nav-open" : ""}`}
    >
      <button
        type="button"
        className="docs-nav-close btn-secondary btn-sm mobile-only"
        onClick={onCloseDocsNav}
      >
        Close document list
      </button>
      <DocsSidebarNav
        onToggleTheme={onToggleTheme}
        ThemeToggleButton={ThemeToggleButton}
      />
    </aside>
  );
}

const SECURITY_TITLES: Record<string, string> = {
  "least-privilege": "Least Privilege",
  azure: "Azure DevOps",
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira Software",
};

const CATEGORY_TITLES: Record<string, string> = {
  tutorials: "Tutorials",
  "how-to": "How-To Guides",
  reference: "Reference",
  explanation: "Explanation",
  security: "Credentials & Scopes",
};

interface ContextActionProps {
  section: SectionId | "";
  isRunDetail: boolean;
  activeRunId: string | undefined;
  stopPending: boolean;
  onStopRun: () => void;
  onStartRun: () => void;
  onAddProject: () => void;
}

/** The action that belongs to the screen in front of the user (#258). */
function ContextAction({
  section,
  isRunDetail,
  activeRunId,
  stopPending,
  onStopRun,
  onStartRun,
  onAddProject,
}: ContextActionProps) {
  if (isRunDetail) {
    if (!activeRunId) return null;
    return (
      <button
        id="btn-stop"
        className="btn-danger btn-sm"
        type="button"
        onClick={onStopRun}
        disabled={stopPending}
      >
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-square" />
        </svg>
        <span>{stopPending ? "Stopping…" : "Stop Run"}</span>
      </button>
    );
  }
  if (section === "tickets") {
    return (
      <button
        id="btn-start-run"
        className="btn-primary btn-sm"
        type="button"
        onClick={onStartRun}
      >
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-plus" />
        </svg>
        <span>Start Run</span>
      </button>
    );
  }
  if (section === "projects") {
    return (
      <button
        id="btn-add-project"
        className="btn-primary btn-sm"
        type="button"
        onClick={onAddProject}
      >
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-plus" />
        </svg>
        <span>Add Project</span>
      </button>
    );
  }
  return null;
}

interface AppShellHeaderProps {
  isDocs: boolean;
  isRunDetail: boolean;
  docsNavOpen: boolean;
  onToggleDocsNav: () => void;
  title: string;
  subtitle: string;
  compact: boolean;
  docBreadcrumb?:
    | {
        category: string;
        item: string;
      }
    | undefined;
  section: SectionId | "";
  onSelectSection: (id: string) => void;
  onToggleTheme: () => void;
  readyLabel: string;
  activeRunId: string | undefined;
  onStopRun: () => void;
  stopPending: boolean;
  onStartRun: () => void;
  onAddProject: () => void;
  onOpenPalette: () => void;
  projects: Project[];
  isProjectsLoading: boolean;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
}

function AppShellHeader({
  isDocs,
  isRunDetail,
  docsNavOpen,
  onToggleDocsNav,
  title,
  subtitle,
  compact,
  docBreadcrumb,
  section,
  onSelectSection,
  onToggleTheme,
  readyLabel,
  activeRunId,
  onStopRun,
  stopPending,
  onStartRun,
  onAddProject,
  onOpenPalette,
  projects,
  isProjectsLoading,
  selectedProjectId,
  onSelectProject,
}: AppShellHeaderProps) {
  const paletteKeys =
    formatShortcut(getShortcut("palette"), isMacPlatform()) ?? "";
  return (
    <header id="content-toolbar" className="toolbar">
      <div className="toolbar-left">
        {isDocs && docBreadcrumb ? (
          <nav
            className="toolbar-breadcrumb"
            aria-label="Documentation Breadcrumbs"
          >
            <div className="docs-header-crumb-trail">
              <span className="docs-header-crumb-root">Documentation</span>
              <span className="docs-header-crumb-sep">›</span>
              <span className="docs-header-crumb-cat">
                {docBreadcrumb.category}
              </span>
              <span className="docs-header-crumb-sep">›</span>
              <span className="docs-header-crumb-current">
                {docBreadcrumb.item}
              </span>
            </div>
            <span id="toolbar-subtitle" className="toolbar-subtitle">
              {subtitle}
            </span>
          </nav>
        ) : isRunDetail ? (
          // A run page is a locked layout with no large title, so its title
          // lives here as the one h1.
          <>
            <h1 id="toolbar-title" className="toolbar-title is-visible">
              {title}
            </h1>
            <span id="toolbar-subtitle" className="toolbar-subtitle">
              {subtitle}
            </span>
          </>
        ) : (
          // The screen's large title is the one h1 here. This copy is for the
          // eye only, and appears in the toolbar once the page has scrolled.
          <span
            className={`toolbar-title${compact ? " is-visible" : ""}`}
            aria-hidden="true"
          >
            {compact ? title : ""}
          </span>
        )}

        {!isDocs && section === "tickets" && projects.length > 0 && (
          <select
            id="select-project"
            className="toolbar-select"
            aria-label="Project"
            value={selectedProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            disabled={isProjectsLoading}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!isDocs && (
        <SegmentedControl
          label={SECTIONS_LABEL}
          value={section}
          onChange={onSelectSection}
          options={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
          className="toolbar-sections desktop-only"
        />
      )}

      <div className="toolbar-actions">
        {isDocs && (
          <button
            type="button"
            className="btn-secondary btn-sm mobile-only"
            aria-expanded={docsNavOpen}
            aria-controls="app-sidebar"
            onClick={onToggleDocsNav}
          >
            Browse documents
          </button>
        )}
        {!isDocs && (
          <ContextAction
            section={section}
            isRunDetail={isRunDetail}
            activeRunId={activeRunId}
            stopPending={stopPending}
            onStopRun={onStopRun}
            onStartRun={onStartRun}
            onAddProject={onAddProject}
          />
        )}
        <button
          type="button"
          id="btn-search"
          className="btn-secondary btn-sm"
          aria-label="Search"
          aria-keyshortcuts="Control+K Meta+K"
          title={`Search (${paletteKeys})`}
          onClick={onOpenPalette}
        >
          <svg className="icon icon-sm" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-search" />
          </svg>
          <span className="search-label">Search</span>
        </button>
        <span
          className="system-status desktop-only"
          title={`X-Factory is ${readyLabel.toLowerCase()}`}
        >
          <span
            className={`status-dot ${readyLabel === "Ready" ? "online" : "offline"}`}
            aria-hidden="true"
          />
          <span className="status-label">{readyLabel}</span>
        </span>
        <ThemeToggleButton
          id="theme-toggle"
          className="theme-toggle"
          onToggle={onToggleTheme}
        />
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `toolbar-gear ${isActive ? "active" : ""}`
          }
          aria-label="Settings"
          title="Settings"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-settings" />
          </svg>
        </NavLink>
      </div>
    </header>
  );
}

function AppShellMobileTabBar() {
  return (
    <nav
      id="mobile-tab-bar"
      className="mobile-tab-bar"
      aria-label="Mobile Navigation"
    >
      {SECTIONS.map((section) => (
        <NavLink
          key={section.id}
          to={`/${section.id}`}
          className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        >
          <svg className="icon icon-lg" aria-hidden="true">
            <use href={`/assets/icons/sprite.svg#${section.icon}`} />
          </svg>
          <span>{section.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppShellContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    projects,
    isProjectsLoading,
    selectedProjectId,
    setSelectedProjectId,
  } = useCurrentProject();
  const { openNewRunModal, openOnboardingModal } = useModal();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { toggleTheme, setAppearance } = useTheme();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  // The settings object is the source of truth for Appearance (#248) and the
  // Theme choice (#249); browser storage only lets the pre-paint script apply
  // them before React loads.
  const savedAppearance = settings?.appearance;
  useEffect(() => {
    if (savedAppearance) setAppearance(savedAppearance);
  }, [savedAppearance, setAppearance]);
  const savedTheme = settings?.theme;
  useEffect(() => {
    if (savedTheme) setTheme(resolveInitialTheme(savedTheme));
  }, [savedTheme]);
  const handleToggleTheme = () => {
    saveSettings.mutate({ appearance: toggleTheme() });
  };
  const stopRunMutation = useStopRun();

  const runIdMatch = location.pathname.match(/^\/runs\/([^/]+)/);
  const runId = runIdMatch ? runIdMatch[1] : undefined;
  const { data: runData } = useRun(runId);

  // A run the user may stop (the server's stop guard set); the shell only
  // offers Stop Run while the run accepts it.
  const isActiveRun =
    runData != null && STOPPABLE_RUN_STATUSES.has(runData.status);
  const activeRunId = isActiveRun ? runData.id : undefined;

  const handleStopRun = () => {
    if (!activeRunId) return;
    if (!confirm("Are you sure you want to stop this run?")) return;
    stopRunMutation.mutate(activeRunId);
  };

  useGlobalShortcuts({
    togglePalette: () => setPaletteOpen((open) => !open),
    openHelp: () => setShortcutsOpen(true),
    newRun: () => openNewRunModal(),
    navigate,
  });

  const { data: readiness } = useReadiness();
  const readyLabel = readiness?.ready !== false ? "Ready" : "Degraded";

  const isDocs = location.pathname.startsWith("/docs");
  const isRunDetail = Boolean(location.pathname.match(/^\/runs\/[^/]+/));
  const section = sectionFor(location.pathname);
  const { title: genericTitle, subtitle: genericSubtitle } = getActiveTitle(
    location.pathname,
  );

  const title = runData
    ? `#${runData.ticket?.id || runData.id} — ${runData.ticket?.title || "Task"}`
    : genericTitle;
  const subtitle = runData
    ? `${runData.project?.name} · ${runData.branch}`
    : genericSubtitle;

  const [searchParams] = useSearchParams();
  const docCategory = searchParams.get("cat") || "tutorials";
  const docSlug = searchParams.get("slug") || "first-agent-run";

  const docBreadcrumb = isDocs
    ? {
        category:
          CATEGORY_TITLES[docCategory] ||
          docCategory.charAt(0).toUpperCase() +
            docCategory.slice(1).replace("-", " "),
        item:
          docCategory === "security"
            ? SECURITY_TITLES[docSlug] || docSlug
            : docSlug
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" "),
      }
    : undefined;

  const [docsNavOpen, setDocsNavOpen] = useState(false);
  // Choosing a document (the URL changes) dismisses the phone-width sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the trigger, not read in the body
  useEffect(() => {
    setDocsNavOpen(false);
  }, [docCategory, docSlug, isDocs]);

  // The large title shrinks into the toolbar once the page scrolls. On desktop
  // the scrolling element is <main>; at phone width the window scrolls.
  const [compact, setCompact] = useState(false);
  const onMainScroll = (event: UIEvent<HTMLElement>) => {
    setCompact(event.currentTarget.scrollTop > COMPACT_TITLE_SCROLL);
  };
  useEffect(() => {
    const onWindowScroll = () => {
      setCompact(window.scrollY > COMPACT_TITLE_SCROLL);
    };
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWindowScroll);
  }, []);

  return (
    <div id="app-shell" className="app-shell">
      {isDocs && (
        <DocsSidebar
          docsNavOpen={docsNavOpen}
          onCloseDocsNav={() => setDocsNavOpen(false)}
          onToggleTheme={handleToggleTheme}
        />
      )}

      <main
        id="app-main"
        className={`main-content ${isRunDetail ? "main-content-locked" : ""}`}
        onScroll={onMainScroll}
      >
        <AppShellHeader
          isDocs={isDocs}
          isRunDetail={isRunDetail}
          docsNavOpen={docsNavOpen}
          onToggleDocsNav={() => setDocsNavOpen((open) => !open)}
          title={title}
          subtitle={subtitle}
          compact={compact}
          docBreadcrumb={docBreadcrumb}
          section={section}
          onSelectSection={(id) => navigate(`/${id}`)}
          onToggleTheme={handleToggleTheme}
          readyLabel={readyLabel}
          activeRunId={activeRunId}
          onStopRun={handleStopRun}
          stopPending={stopRunMutation.isPending}
          onStartRun={() => openNewRunModal()}
          onAddProject={() => openOnboardingModal()}
          onOpenPalette={() => setPaletteOpen(true)}
          projects={projects}
          isProjectsLoading={isProjectsLoading}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />

        <div
          id="viewport-container"
          className={`viewport-container ${isRunDetail ? "viewport-container-locked" : ""}`}
        >
          {!isDocs && !isRunDetail && (
            <div className="page-heading">
              <h1 id="page-title" className="large-title">
                {genericTitle}
              </h1>
              <p className="page-subtitle">{genericSubtitle}</p>
            </div>
          )}

          <Outlet />
        </div>
      </main>

      <AppShellMobileTabBar />
      <ModalContainer />
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        stopRunAvailable={activeRunId !== undefined}
        onStopRun={handleStopRun}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutSheet
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}

export function AppShell() {
  return (
    <ProjectProvider>
      <ModalProvider>
        <AppShellContent />
      </ModalProvider>
    </ProjectProvider>
  );
}
