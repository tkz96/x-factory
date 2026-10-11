// src/frontend/routes.tsx — React Router route declarations (XFM-39, XFM-44).

import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { DocsView } from "./views/DocsView.js";
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
        element: <Navigate to="/tickets" replace />,
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
      {
        path: "*",
        element: <Navigate to="/tickets" replace />,
      },
    ],
  },
];

export const router =
  typeof document !== "undefined"
    ? createBrowserRouter(routeDefinitions)
    : createMemoryRouter(routeDefinitions);
