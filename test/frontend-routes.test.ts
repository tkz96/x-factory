// test/frontend-routes.test.ts — Unit tests for React Router route declarations (XFM-39, XFM-44).

import { describe, expect, it } from "bun:test";
import { router } from "../src/frontend/routes.js";

describe("React Router Configuration (XFM-39, XFM-44)", () => {
  it("defines root app shell route", () => {
    const rootRoute = router.routes[0];
    expect(rootRoute).toBeDefined();
    expect(rootRoute?.path).toBe("/");
    expect(rootRoute?.children).toBeDefined();
  });

  it("defines all canonical workbench routes", () => {
    const rootRoute = router.routes[0];
    const children = rootRoute?.children || [];

    const paths = children.map((c) => c.path);

    // Default redirect
    expect(children.some((c) => c.index === true)).toBe(true);

    // Workbench paths (XFM-39)
    expect(paths).toContain("queue");
    expect(paths).toContain("runs");
    expect(paths).toContain("runs/:runId"); // Canonical run route (XFM-44)
    expect(paths).toContain("history");
    expect(paths).toContain("projects");
    expect(paths).toContain("projects/:id");
    expect(paths).toContain("settings");
    expect(paths).toContain("*");
  });
});
