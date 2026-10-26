// src/frontend/routes.tsx — React Router route declarations (XFM-39, XFM-44).

import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { HomeRoute } from "./components/welcome/HomeRoute.js";
import { DocsView } from "./views/DocsView.js";
import { NotFoundView } from "./views/NotFoundView.js";
import { ProjectDetailView } from "./views/ProjectDetailView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { QueueView } from "./views/QueueView.js";
import { RunDetailView } from "./views/RunDetailView.js";
import { RunsView } from "./views/RunsView.js";
import { SettingsView } from "./views/SettingsView.js";
import { WelcomeView } from "./views/WelcomeView.js";

/**
 * The dev-only specimen route (spec #292, step 2). `import.meta.env.DEV` is
 * false in a production build, so the early return drops the lazy import and
 * the specimen module leaves the bundle entirely.
 */
function devOnlyRoutes(): RouteObject[] {
  if (!import.meta.env.DEV) return [];
  const SpecimenView = lazy(() =>
    import("./views/SpecimenView.js").then((m) => ({
      default: m.SpecimenView,
    })),
  );
  return [
    {
      path: "__specimen",
      element: (
        <Suspense fallback={null}>
          <SpecimenView />
        </Suspense>
      ),
    },
  ];
}

export const routeDefinitions: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        // The landing: the welcome while setup is incomplete, Tickets after
        // every step is done (#269).
        index: true,
        element: <HomeRoute />,
      },
      {
        path: "welcome",
        element: <WelcomeView />,
      },
      {
        path: "tickets",
        element: <QueueView />,
      },
      // The old Queue route moved to Tickets (#258).
      {
        path: "queue",
        element: <Navigate to="/tickets" replace />,
      },
      {
        path: "runs",
        element: <RunsView />,
      },
      {
        path: "runs/:runId",
        element: <RunDetailView />,
      },
      // History is the Done filter of Runs (#258).
      {
        path: "history",
        element: <Navigate to="/runs?filter=done" replace />,
      },
      {
        path: "projects",
        element: <ProjectsView />,
      },
      {
        path: "projects/:id",
        element: <ProjectDetailView />,
      },
      {
        path: "settings",
        element: <SettingsView />,
      },
      {
        path: "docs",
        element: <DocsView />,
      },
      ...devOnlyRoutes(),
      {
        // An address no screen claims says so, in place, rather than
        // silently redirecting to Tickets.
        path: "*",
        element: <NotFoundView />,
      },
    ],
  },
];

export const router =
  typeof document !== "undefined"
    ? createBrowserRouter(routeDefinitions)
    : createMemoryRouter(routeDefinitions);
