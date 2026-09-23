import "./AppShell.css";

import {
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import type { Project } from "../../shared/types.js";
import { ModalProvider, useModal } from "../context/ModalContext.js";
import {
  ProjectProvider,
  useCurrentProject,
} from "../context/ProjectContext.js";
import { useReadiness, useRuns, useTickets } from "../hooks/useQueries.js";
import { useTheme } from "../hooks/useTheme.js";
import { DocsSidebarNav } from "./docs/DocsSidebarNav.js";
import { ModalContainer } from "./ModalContainer.js";

function getActiveTitle(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/runs/")) {
    return {
      title: "Run Detail",
      subtitle: "Live execution events and stage artifacts",
    };
  }
  if (pathname.startsWith("/projects/")) {
    return {
      title: "Project Detail",
      subtitle: "Repository workspace and tracker configuration",
    };
  }
  switch (pathname) {
    case "/runs":
      return {
        title: "Active Runs",
        subtitle: "In-flight agentic pipelines and verification",
      };
    case "/history":
      return {
        title: "Execution History",
        subtitle: "Audit log of past ticket implementations",
      };
    case "/projects":
      return {
        title: "Projects",
        subtitle: "Workspace repositories and issue tracker connections",
      };
    case "/settings":
      return {
        title: "Settings",
        subtitle: "LLM model selection, API credentials, and runtime limits",
      };
    case "/docs":
      return {
        title: "Documentation",
        subtitle: "Personal Access Token scopes, architecture & security guide",
      };
    default:
      return {
        title: "Work Queue",
        subtitle: "Tickets ready for agentic implementation",
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

interface AppShellSidebarProps {
  isDocs: boolean;
  projects: Project[];
  isProjectsLoading: boolean;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  queueCount: number;
  activeRunsCount: number;
  readiness: ReturnType<typeof useReadiness>["data"];
  onToggleTheme: () => void;
}

function AppShellSidebar({
  isDocs,
  projects,
  isProjectsLoading,
  selectedProjectId,
  onSelectProject,
  queueCount,
  activeRunsCount,
  readiness,
  onToggleTheme,
}: AppShellSidebarProps) {
  if (isDocs) {
    return (
      <aside id="app-sidebar" className="sidebar">
        <DocsSidebarNav
          onToggleTheme={onToggleTheme}
          ThemeToggleButton={ThemeToggleButton}
        />
      </aside>
    );
  }

  return (
    <aside id="app-sidebar" className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-title">X-Factory</span>
        </div>

        <div className="project-selector-wrapper">
          <label htmlFor="select-project" className="sr-only">
            Target Project
          </label>
          <select
            id="select-project"
            className="sidebar-select"
            value={selectedProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            disabled={isProjectsLoading || projects.length === 0}
          >
            {isProjectsLoading ? (
              <option value="" disabled>
                Loading projects…
              </option>
            ) : projects.length === 0 ? (
              <option value="" disabled>
                No projects configured
              </option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <nav id="sidebar-nav" className="sidebar-nav">
        <div className="nav-section-title">WORKBENCH</div>

        <NavLink
          to="/queue"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          data-area="queue"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-layers" />
          </svg>
          <span>Work Queue</span>
          <span id="queue-badge" className="nav-badge">
            {queueCount}
          </span>
        </NavLink>

        <NavLink
          to="/runs"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          data-area="runs"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-play" />
          </svg>
          <span>Active Runs</span>
          {activeRunsCount > 0 && (
            <span id="active-runs-badge" className="nav-badge pulse">
              {activeRunsCount}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/history"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          data-area="history"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-clock" />
          </svg>
          <span>History</span>
        </NavLink>

        <div className="nav-section-title">CONFIGURATION</div>

        <NavLink
          to="/projects"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          data-area="projects"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-folder" />
          </svg>
          <span>Projects</span>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          data-area="settings"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-settings" />
          </svg>
          <span>Settings</span>
        </NavLink>

        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-item"
          data-area="docs"
          title="Open Documentation in New Tab"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-book-open" />
          </svg>
          <span>Documentation ↗</span>
        </a>

        <a
          href="/reference"
          target="_blank"
          rel="noreferrer"
          className="nav-item"
          data-area="reference"
          title="Open Interactive Scalar API Reference"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-code" />
          </svg>
          <span>API Reference ↗</span>
        </a>
      </nav>

      <div className="sidebar-footer">
        <div className="system-status">
          <span
            className={`status-dot ${readiness?.ready !== false ? "online" : "offline"}`}
          />
          <span className="status-label">
            {readiness?.ready !== false ? "Factory Ready" : "Degraded"}
          </span>
        </div>
        <ThemeToggleButton
          id="theme-toggle"
          className="theme-toggle"
          onToggle={onToggleTheme}
        />
      </div>
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

interface AppShellHeaderProps {
  isDocs: boolean;
  title: string;
  subtitle: string;
  docBreadcrumb?:
    | {
        category: string;
        item: string;
      }
    | undefined;
  onToggleTheme: () => void;
  onOpenNewRun: () => void;
}

function AppShellHeader({
  isDocs,
  title,
  subtitle,
  docBreadcrumb,
  onToggleTheme,
  onOpenNewRun,
}: AppShellHeaderProps) {
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
        ) : (
          <>
            <h1 id="toolbar-title">{title}</h1>
            <span id="toolbar-subtitle" className="toolbar-subtitle">
              {subtitle}
            </span>
          </>
        )}
      </div>
      <div className="toolbar-actions">
        <ThemeToggleButton
          id="theme-toggle-mobile"
          className="theme-toggle mobile-only"
          onToggle={onToggleTheme}
        />
        {!isDocs && (
          <button
            id="btn-open-new-run"
            className="btn-primary btn-sm"
            type="button"
            onClick={onOpenNewRun}
          >
            <svg className="icon icon-sm" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-plus" />
            </svg>
            <span>New Run</span>
          </button>
        )}
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
      <NavLink
        to="/queue"
        className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        data-area="queue"
      >
        <svg className="icon icon-lg" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-layers" />
        </svg>
        <span>Queue</span>
      </NavLink>
      <NavLink
        to="/runs"
        className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        data-area="runs"
      >
        <svg className="icon icon-lg" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-play" />
        </svg>
        <span>Runs</span>
      </NavLink>
      <NavLink
        to="/history"
        className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        data-area="history"
      >
        <svg className="icon icon-lg" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-clock" />
        </svg>
        <span>History</span>
      </NavLink>
      <NavLink
        to="/projects"
        className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        data-area="projects"
      >
        <svg className="icon icon-lg" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-folder" />
        </svg>
        <span>Projects</span>
      </NavLink>
      <NavLink
        to="/settings"
        className={({ isActive }) => `tab-item ${isActive ? "active" : ""}`}
        data-area="settings"
      >
        <svg className="icon icon-lg" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-settings" />
        </svg>
        <span>Settings</span>
      </NavLink>
    </nav>
  );
}

function AppShellContent() {
  const location = useLocation();
  const {
    projects,
    isProjectsLoading,
    selectedProjectId,
    setSelectedProjectId,
  } = useCurrentProject();
  const { openNewRunModal } = useModal();
  const { toggleTheme } = useTheme();

  const { data: runs = [] } = useRuns();
  const { data: tickets = [] } = useTickets(selectedProjectId);
  const { data: readiness } = useReadiness();

  const activeRunsCount = runs.filter(
    (r) =>
      r.status !== "pr_created" &&
      r.status !== "failed" &&
      r.status !== "stopped",
  ).length;

  const queueCount = tickets.length;
  const isDocs = location.pathname.startsWith("/docs");
  const { title, subtitle } = getActiveTitle(location.pathname);

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

  return (
    <div id="app-shell" className="app-shell">
      <AppShellSidebar
        isDocs={isDocs}
        projects={projects}
        isProjectsLoading={isProjectsLoading}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        queueCount={queueCount}
        activeRunsCount={activeRunsCount}
        readiness={readiness}
        onToggleTheme={toggleTheme}
      />

      <main id="app-main" className="main-content">
        <AppShellHeader
          isDocs={isDocs}
          title={title}
          subtitle={subtitle}
          docBreadcrumb={docBreadcrumb}
          onToggleTheme={toggleTheme}
          onOpenNewRun={openNewRunModal}
        />

        <div id="viewport-container" className="viewport-container">
          <Outlet />
        </div>
      </main>

      <AppShellMobileTabBar />
      <ModalContainer />
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
