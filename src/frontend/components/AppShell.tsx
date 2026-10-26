import "./AppShell.css";
import "./AppShellDocsPhone.css";

import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { STOPPABLE_RUN_STATUSES } from "../../shared/run-status-policy.js";
import { ModalProvider, useModal } from "../context/ModalContext.js";
import { NotificationProvider } from "../context/NotificationContext.js";
import {
  PageHeaderProvider,
  usePageHeaderContent,
} from "../context/PageHeaderContext.js";
import { ProjectProvider } from "../context/ProjectContext.js";
import {
  useProjects,
  useReadiness,
  useRun,
  useRuns,
  useSaveSettings,
  useSettings,
  useStopRun,
} from "../hooks/useQueries.js";
import { resolveInitialTheme, setTheme, useTheme } from "../hooks/useTheme.js";
import { countRunsByFilter } from "../lib/runs-list.js";
import { type ShortcutId, shortcutLabel } from "../shortcuts/registry.js";
import { useGlobalShortcuts } from "../shortcuts/useGlobalShortcuts.js";
import { DocsSidebarNav } from "./docs/DocsSidebarNav.js";
import {
  NOT_FOUND_COPY,
  STATUS_COPY,
  WELCOME_COPY,
} from "./feedback/copy-map.js";
import { ModalContainer } from "./ModalContainer.js";
import { DesktopBanners } from "./notifications/DesktopBanners.js";
import { NotificationActivity } from "./notifications/NotificationActivity.js";
import { NotificationBell } from "./notifications/NotificationBell.js";
import {
  AlertDialog,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "./overlays/index.js";
import { CommandPalette } from "./palette/CommandPalette.js";
import { ShortcutSheet } from "./palette/ShortcutSheet.js";
import { ProjectScopePicker } from "./projects/ProjectScopePicker.js";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Icon } from "./ui/Icon.js";
import { PageHeader } from "./ui/PageHeader.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { useMediaQuery } from "./ui/useMediaQuery.js";

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
  // The landing is the welcome gate (#269): while setup is incomplete the
  // welcome is what the user is looking at, so the screen's words are its own.
  if (pathname === "/" || pathname.startsWith("/welcome")) {
    return {
      title: WELCOME_COPY.title,
      subtitle: WELCOME_COPY.subtitle,
    };
  }
  switch (pathname) {
    case "/tickets":
    case "/queue":
      return {
        title: "Tickets",
        subtitle: "Pick a ticket to start a run",
      };
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
    // The Docs screen's own header is its breadcrumb; this is the subtitle
    // under it, not the Tickets copy the default used to give.
    case "/docs":
      return {
        title: "Documentation",
        subtitle: "Tutorials, how-to guides and reference",
      };
    default:
      // An address no screen claims renders the not-found screen; the
      // header says so too.
      return {
        title: NOT_FOUND_COPY.title,
        subtitle: NOT_FOUND_COPY.subtitle,
      };
  }
}

const SECTIONS_LABEL = "Sections";

interface DocsSidebarProps {
  docsNavOpen: boolean;
  onCloseDocsNav: () => void;
}

/** The Docs document list. It is the Docs screen's own navigation, not the app's. */
function DocsSidebar({ docsNavOpen, onCloseDocsNav }: DocsSidebarProps) {
  return (
    <aside
      id="app-sidebar"
      className={`sidebar${docsNavOpen ? " docs-nav-open" : ""}`}
    >
      <Button
        variant="secondary"
        size="sm"
        className="docs-nav-close mobile-only"
        onPress={onCloseDocsNav}
      >
        Close document list
      </Button>
      <DocsSidebarNav />
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

/** "Start Run (N)": a label with its registry shortcut, or the bare label when it has none. */
function withShortcut(label: string, id: ShortcutId): string {
  const keys = shortcutLabel(id);
  return keys ? `${label} (${keys})` : label;
}

/** The registry keys on the right of a menu row; nothing when the action has no chord. */
function MenuShortcut({ id }: { id: ShortcutId }) {
  const keys = shortcutLabel(id);
  return keys ? (
    <kbd className="xf-menu-keys text-caption-1">{keys}</kbd>
  ) : null;
}

interface RunActionsMenuProps {
  activeRunId: string | undefined;
  stopPending: boolean;
  onStopRun: () => void;
}

/**
 * The run page's own menu. Stop Run lives in the "…" menu, not as a toolbar
 * button (#262); a screen's own action belongs to the page heading, never to
 * the toolbar (DESIGN.md §7).
 */
function RunActionsMenu({
  activeRunId,
  stopPending,
  onStopRun,
}: RunActionsMenuProps) {
  if (!activeRunId) return null;
  return (
    <MenuTrigger>
      <Button
        id="btn-run-menu"
        variant="quiet"
        aria-label="Run actions"
        isDisabled={stopPending}
      >
        <span aria-hidden="true">…</span>
      </Button>
      <Popover placement="bottom end">
        <Menu>
          <MenuItem id="menu-stop-run" isDanger onAction={onStopRun}>
            <span>Stop Run</span>
            <MenuShortcut id="stopRun" />
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

interface PageActionProps {
  section: SectionId | "";
  onStartRun: () => void;
  onAddProject: () => void;
}

/**
 * The screen's one action, in the large-title row (DESIGN.md §7): Tickets
 * offers a secondary Start Run, Projects the primary Add Project. The label
 * collapses to the icon at phone width, so the accessible name is explicit and
 * never depends on the text that is hidden.
 */
function PageAction({ section, onStartRun, onAddProject }: PageActionProps) {
  if (section === "tickets") {
    return (
      <Button
        id="btn-start-run"
        variant="secondary"
        icon="icon-plus"
        aria-label="Start Run"
        title={withShortcut("Start Run", "newRun")}
        onPress={onStartRun}
      >
        <span className="page-action-label">Start Run</span>
      </Button>
    );
  }
  if (section === "projects") {
    return (
      <Button
        id="btn-add-project"
        variant="primary"
        icon="icon-plus"
        aria-label="Add Project"
        onPress={onAddProject}
      >
        <span className="page-action-label">Add Project</span>
      </Button>
    );
  }
  return null;
}

interface PageHeaderSlotProps {
  /** The shell's own title, standing until a view claims the heading. */
  title: string;
  /** The shell's own subtitle for the address, standing the same way. */
  subtitle: string;
  /** The section's page action, standing until a view brings its own. */
  actions: ReactNode;
}

/**
 * The page heading the shell renders (#298): the mounted view's claim when
 * there is one — its title, its subtitle and its actions — and the shell's
 * own title and section action otherwise. It is the same slot at desktop and
 * phone width; the toolbar picks the claimed title up when the page scrolls.
 */
function PageHeaderSlot({ title, subtitle, actions }: PageHeaderSlotProps) {
  const provided = usePageHeaderContent();
  const resolvedActions =
    provided !== null && provided.actions !== undefined
      ? provided.actions
      : actions;
  return (
    <PageHeader
      title={provided?.title ?? title}
      subtitle={provided?.subtitle ?? subtitle}
      actions={resolvedActions}
    />
  );
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
  /** Runs in a Needs-you status: the Runs segment's count (#259). */
  needsYouCount: number;
  /** True when the workbench is degraded: the toolbar then says so, once. */
  isDegraded: boolean;
  activeRunId: string | undefined;
  onStopRun: () => void;
  stopPending: boolean;
  onOpenPalette: () => void;
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
  needsYouCount,
  isDegraded,
  activeRunId,
  onStopRun,
  stopPending,
  onOpenPalette,
}: AppShellHeaderProps) {
  // A view that claims the page heading names itself everywhere the title
  // shows: the compact toolbar copy and the run-page heading included (#298).
  // Only this component and PageHeaderSlot read the claim, so a claim change
  // re-renders the bar and the heading — never the view that made it.
  const providedHeader = usePageHeaderContent();
  // The breadcrumb and the search label take the phone and compact sizes.
  const phoneWidth = useMediaQuery("(max-width: 768px)");
  const compactSearch = useMediaQuery("(max-width: 1320px)");
  const headingTitle = providedHeader?.title ?? title;
  const headingSubtitle = providedHeader?.subtitle ?? subtitle;
  return (
    <header
      id="content-toolbar"
      className={`toolbar${isDocs ? " toolbar--docs" : ""}`}
    >
      <div className="toolbar-left">
        {isDocs && docBreadcrumb ? (
          <nav
            className="toolbar-breadcrumb"
            aria-label="Documentation Breadcrumbs"
          >
            <div
              className={`docs-header-crumb-trail font-bold ${phoneWidth ? "text-headline" : "text-title-2"}`}
            >
              <span className="docs-header-crumb-root">Documentation</span>
              <span className="docs-header-crumb-sep font-regular">›</span>
              <span className="docs-header-crumb-cat">
                {docBreadcrumb.category}
              </span>
              <span className="docs-header-crumb-sep font-regular">›</span>
              <span className="docs-header-crumb-current">
                {docBreadcrumb.item}
              </span>
            </div>
            <span
              id="toolbar-subtitle"
              className="toolbar-subtitle text-caption-1"
            >
              {headingSubtitle}
            </span>
          </nav>
        ) : isRunDetail ? (
          // A run page is a locked layout with no large title, so its title
          // lives here as the one h1: one line with an ellipsis, the project and
          // branch beneath it as a caption, only the title on a phone (#258, F3).
          <div className="toolbar-run-heading">
            <h1
              id="toolbar-title"
              className="toolbar-title is-visible text-headline font-semibold"
            >
              {headingTitle}
            </h1>
            <span
              id="toolbar-subtitle"
              className="toolbar-subtitle text-caption-1"
            >
              {headingSubtitle}
            </span>
          </div>
        ) : (
          // The screen's large title is the one h1 here. This copy is for the
          // eye only, and appears in the toolbar once the page has scrolled —
          // until then nothing is rendered, so the bar never holds an empty
          // title span (#258).
          compact && (
            <span
              className="toolbar-title is-visible text-title-3 font-bold"
              aria-hidden="true"
            >
              {headingTitle}
            </span>
          )
        )}

        {!isDocs &&
          !isRunDetail &&
          (section === "tickets" || section === "runs") && (
            <ProjectScopePicker />
          )}

        {!isDocs && <NotificationActivity />}
      </div>

      {!isDocs && (
        <SegmentedControl
          label={SECTIONS_LABEL}
          value={section}
          onChange={onSelectSection}
          options={SECTIONS.map((s) => ({
            id: s.id,
            label: s.label,
            count:
              s.id === "runs" && needsYouCount > 0 ? needsYouCount : undefined,
          }))}
          className="toolbar-sections desktop-only"
        />
      )}

      <div className="toolbar-actions">
        {isDocs && (
          <Button
            variant="secondary"
            size="sm"
            className="mobile-only"
            aria-expanded={docsNavOpen}
            aria-controls="app-sidebar"
            onPress={onToggleDocsNav}
          >
            Browse documents
          </Button>
        )}
        {!isDocs && isRunDetail && (
          <RunActionsMenu
            activeRunId={activeRunId}
            stopPending={stopPending}
            onStopRun={onStopRun}
          />
        )}
        {!isDocs && (
          <Button
            id="btn-search"
            variant="quiet"
            className="toolbar-search font-medium"
            icon="icon-search"
            aria-label="Search"
            title={withShortcut("Search", "palette")}
            aria-keyshortcuts="Control+K Meta+K"
            onPress={onOpenPalette}
          >
            <span
              className={
                compactSearch
                  ? "toolbar-search-label text-caption-2"
                  : "toolbar-search-label"
              }
            >
              Search
            </span>
            <kbd className="toolbar-search-keys text-caption-1">
              {shortcutLabel("palette")}
            </kbd>
          </Button>
        )}
        {!isDocs && <NotificationBell />}
        {/* Nothing at all when the workbench is ready; one orange item that
            links to the screen that can act on it when it is not. */}
        {!isDocs && isDegraded && (
          <Link
            to="/settings?tab=diagnostics"
            className="toolbar-readiness desktop-only text-footnote font-semibold"
          >
            <Badge tone="warning">
              <Icon name="icon-alert-circle" size="sm" />
              {STATUS_COPY.degraded}
            </Badge>
          </Link>
        )}
        {!isDocs && (
          <NavLink
            to="/settings"
            className="ui-icon-button ui-icon-button--plain toolbar-settings"
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="icon-settings" size="md" />
          </NavLink>
        )}
      </div>
    </header>
  );
}

function AppShellMobileTabBar({ needsYouCount }: { needsYouCount: number }) {
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
          className={({ isActive }) =>
            `tab-item text-caption-2 font-medium ${isActive ? "active" : ""}`
          }
        >
          <Icon name={section.icon} size="lg" />
          <span>{section.label}</span>
          {section.id === "runs" && needsYouCount > 0 && (
            <span className="tab-count text-caption-2">{needsYouCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function AppShellContent() {
  const location = useLocation();
  const navigate = useNavigate();
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
  // The app-wide stream (#257) keeps the runs cache live on every screen, so the
  // Runs badge and the tab title follow a run from any section (#259). It is
  // opened once, by the NotificationProvider that wraps this shell (#264).
  const { data: runsList } = useRuns();
  const needsYouCount = countRunsByFilter(runsList ?? [])["needs-you"];
  useEffect(() => {
    document.title =
      needsYouCount > 0 ? `(${needsYouCount}) X-Factory` : "X-Factory";
  }, [needsYouCount]);

  const runIdMatch = location.pathname.match(/^\/runs\/([^/]+)/);
  const runId = runIdMatch ? runIdMatch[1] : undefined;
  const { data: runData } = useRun(runId);

  // A run the user may stop (the server's stop guard set); the shell only
  // offers Stop Run while the run accepts it.
  const isActiveRun =
    runData != null && STOPPABLE_RUN_STATUSES.has(runData.status);
  const activeRunId = isActiveRun ? runData.id : undefined;

  // Stop Run asks first, naming the branch; the palette and the toolbar menu share this (#262).
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const handleStopRun = () => {
    if (!activeRunId) return;
    setStopConfirmOpen(true);
  };
  const confirmStopRun = () => {
    if (activeRunId) stopRunMutation.mutate(activeRunId);
  };

  useGlobalShortcuts({
    togglePalette: () => setPaletteOpen((open) => !open),
    openHelp: () => setShortcutsOpen(true),
    newRun: () => openNewRunModal(),
    navigate,
  });

  const { data: readiness } = useReadiness();
  // The toolbar says nothing while the workbench is ready; a degraded one gets
  // one orange link to Settings › Diagnostics.
  const isDegraded = readiness?.ready === false;

  const isDocs = location.pathname.startsWith("/docs");
  const isRunDetail = Boolean(location.pathname.match(/^\/runs\/[^/]+/));
  // The welcome is a full-window screen (#269): it keeps the shell's providers
  // and its own title, and loses the toolbar and the tab bar, which would
  // otherwise frame a first-run screen with navigation for work that is not set
  // up yet. Its checklist links are how the user moves on.
  const isWelcome = location.pathname.startsWith("/welcome");
  const section = sectionFor(location.pathname);
  const { title: genericTitle, subtitle: genericSubtitle } = getActiveTitle(
    location.pathname,
  );
  // A project's page is named by the project, so the detail pane below the
  // heading carries no second title of its own.
  const projectIdMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const { data: projectsForHeading } = useProjects();
  const headingProject = projectIdMatch
    ? projectsForHeading?.find((p) => p.id === projectIdMatch[1])
    : undefined;

  // A run is named by its ticket id, without punctuation around it (#SYS: the
  // id reads GH-3 everywhere).
  const title = runData
    ? `${runData.ticket?.id || runData.id} — ${runData.ticket?.title || "Task"}`
    : (headingProject?.name ?? genericTitle);
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
    <div
      id="app-shell"
      className={`app-shell${isWelcome ? " app-shell--welcome" : ""}`}
    >
      {isDocs && (
        <DocsSidebar
          docsNavOpen={docsNavOpen}
          onCloseDocsNav={() => setDocsNavOpen(false)}
        />
      )}

      <main
        id="app-main"
        className={`main-content ${isRunDetail ? "main-content-locked" : ""}`}
        onScroll={onMainScroll}
      >
        {/* The heading slot wraps the bar and the view: while a view is
            mounted it claims this heading through usePageHeader (#298), and
            the toolbar and the heading below read the same claim. */}
        <PageHeaderProvider>
          {!isWelcome && (
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
              needsYouCount={needsYouCount}
              isDegraded={isDegraded}
              activeRunId={activeRunId}
              onStopRun={handleStopRun}
              stopPending={stopRunMutation.isPending}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          )}

          <div
            id="viewport-container"
            className={`viewport-container ${isRunDetail ? "viewport-container-locked" : ""}`}
          >
            {!isDocs && !isRunDetail && (
              <PageHeaderSlot
                title={title}
                subtitle={genericSubtitle}
                actions={
                  <PageAction
                    section={section}
                    onStartRun={() => openNewRunModal()}
                    onAddProject={() => openOnboardingModal()}
                  />
                }
              />
            )}

            <Outlet />
          </div>
        </PageHeaderProvider>
      </main>

      {!isWelcome && <AppShellMobileTabBar needsYouCount={needsYouCount} />}
      <ModalContainer />
      {/* Desktop banners for live run events (#265). Renders nothing. */}
      <DesktopBanners />
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        stopRunAvailable={activeRunId !== undefined}
        onStopRun={handleStopRun}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onToggleAppearance={handleToggleTheme}
      />
      <ShortcutSheet
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <AlertDialog
        id="alert-stop-run"
        isOpen={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        title={`Stop run on ${runData?.branch ?? "this branch"}?`}
        description="Stopping ends this run. It can't be undone."
        confirmText="Stop Run"
        cancelText="Keep Running"
        variant="danger"
        onConfirm={confirmStopRun}
      />
    </div>
  );
}

export function AppShell() {
  return (
    <ProjectProvider>
      <ModalProvider>
        <NotificationProvider>
          <AppShellContent />
        </NotificationProvider>
      </ModalProvider>
    </ProjectProvider>
  );
}
