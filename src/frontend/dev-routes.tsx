// src/frontend/dev-routes.tsx — the dev-only routes (spec #292, step 2, #294).
//
// routes.tsx includes these only when import.meta.env.DEV is true. The lazy
// loader is marked pure, so a production build drops this module and the
// specimen page with it.

import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router-dom";

const Specimen = /* @__PURE__ */ lazy(() => import("./views/SpecimenView.js"));

/** The specimen page, loaded on demand. */
export function specimenRoute(): RouteObject {
  return {
    path: "__specimen",
    element: (
      <Suspense fallback={null}>
        <Specimen />
      </Suspense>
    ),
  };
}
