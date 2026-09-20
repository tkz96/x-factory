// src/frontend/routes.tsx — React Router route declarations (XFM-39, XFM-44).

import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { DocsView } from "./views/DocsView.js";
import { HistoryView } from "./views/HistoryView.js";
import { ProjectDetailView } from "./views/ProjectDetailView.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { QueueView } from "./views/QueueView.js";
import { RunDetailView } from "./views/RunDetailView.js";
import { RunsView } from "./views/RunsView.js";
import { SettingsView } from "./views/SettingsView.js";

export const routeDefinitions: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate to="/queue" replace />,
      },
      {
        path: "queue",
        element: <QueueView />,
      },
      {
        path: "runs",
        element: <RunsView />,
      },
      {
        path: "runs/:runId",
        element: <RunDetailView />,
      },
      {
        path: "history",
        element: <HistoryView />,
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
      {
        path: "*",
        element: <Navigate to="/queue" replace />,
      },
    ],
  },
];

export const router =
  typeof document !== "undefined"
    ? createBrowserRouter(routeDefinitions)
    : createMemoryRouter(routeDefinitions);
