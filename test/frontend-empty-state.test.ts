// test/frontend-empty-state.test.ts — Unit tests for EmptyStateCard rendering and variants.

import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { EmptyStateCard } from "../src/frontend/components/EmptyStateCard.js";

describe("Frontend EmptyStateCard Component", () => {
  it("renders loading variant with spinner and custom message", () => {
    const html = renderToString(
      React.createElement(EmptyStateCard, {
        type: "loading",
        title: "Loading Data…",
        message: "Please wait while we fetch runs.",
      }),
    );

    expect(html).toContain("empty-state");
    expect(html).toContain("spinner-sm");
    expect(html).toContain("Loading Data…");
    expect(html).toContain("Please wait while we fetch runs.");
  });

  it("renders error variant with alert icon and error message", () => {
    const html = renderToString(
      React.createElement(EmptyStateCard, {
        type: "error",
        title: "Unable to Load Projects",
        message: "Network request failed with status 500",
      }),
    );

    expect(html).toContain("empty-state");
    expect(html).toContain("empty-icon");
    expect(html).toContain("icon-alert-circle");
    expect(html).toContain("Unable to Load Projects");
    expect(html).toContain("Network request failed with status 500");
  });

  it("renders empty call-to-action variant with icon, text, and action button", () => {
    let actionTriggered = false;
    const html = renderToString(
      React.createElement(EmptyStateCard, {
        type: "empty",
        icon: "icon-folder",
        title: "No Active Projects",
        message: "Click Onboard Project to connect a repository.",
        actionText: "Onboard Project",
        onAction: () => {
          actionTriggered = true;
        },
        className: "custom-grid-span",
      }),
    );

    expect(html).toContain("empty-state");
    expect(html).toContain("custom-grid-span");
    expect(html).toContain("icon-folder");
    expect(html).toContain("No Active Projects");
    expect(html).toContain("Click Onboard Project to connect a repository.");
    expect(html).toContain("Onboard Project");
    expect(actionTriggered).toBe(false);
  });

  it("renders minimal empty variant without icon or button when omitted", () => {
    const html = renderToString(
      React.createElement(EmptyStateCard, {
        message: "No archived projects found.",
      }),
    );

    expect(html).toContain("empty-state");
    expect(html).toContain("No archived projects found.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("empty-icon");
  });
});
