// test/diagrams.test.ts — Unit tests for React Flow technical diagram registry and custom components.

import { describe, expect, it } from "bun:test";
import { ReactFlowProvider } from "@xyflow/react";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  customNodeTypes,
  StandardNode,
} from "../src/frontend/components/diagrams/CustomNodes.js";
import { FlowDiagramViewer } from "../src/frontend/components/diagrams/FlowDiagramViewer.js";
import { DIAGRAM_REGISTRY } from "../src/frontend/components/diagrams/registry.js";

describe("Diagrams Module & React Flow Registry", () => {
  it("defines all required architectural diagrams in DIAGRAM_REGISTRY", () => {
    expect(DIAGRAM_REGISTRY["process-boundaries"]).toBeDefined();
    expect(DIAGRAM_REGISTRY["worker-lease-model"]).toBeDefined();
    expect(DIAGRAM_REGISTRY["event-distribution"]).toBeDefined();
  });

  it("declares valid node and edge structures for process-boundaries", () => {
    const diag = DIAGRAM_REGISTRY["process-boundaries"];
    if (!diag) throw new Error("Missing diagram: process-boundaries");
    expect(diag).toBeDefined();
    expect(diag.id).toBe("process-boundaries");
    expect(diag.title).toContain("Process Boundaries");
    expect(diag.nodes.length).toBeGreaterThanOrEqual(4);
    expect(diag.edges.length).toBeGreaterThanOrEqual(3);

    const apiNode = diag.nodes.find((n) => n.id === "api-server");
    expect(apiNode).toBeDefined();
    expect(apiNode?.data.title).toBe("API Process");

    const dbNode = diag.nodes.find((n) => n.id === "sqlite-db");
    expect(dbNode).toBeDefined();
    expect(dbNode?.data.variant).toBe("db");
  });

  it("declares valid node and edge structures for worker-lease-model", () => {
    const diag = DIAGRAM_REGISTRY["worker-lease-model"];
    if (!diag) throw new Error("Missing diagram: worker-lease-model");
    expect(diag).toBeDefined();
    expect(diag.id).toBe("worker-lease-model");
    expect(diag.nodes.length).toBeGreaterThanOrEqual(5);
    expect(diag.edges.length).toBeGreaterThanOrEqual(4);

    const pendingNode = diag.nodes.find((n) => n.id === "lease-pending");
    expect(pendingNode).toBeDefined();
    expect(pendingNode?.data.variant).toBe("state-pending");
  });

  it("declares valid node and edge structures for event-distribution", () => {
    const diag = DIAGRAM_REGISTRY["event-distribution"];
    if (!diag) throw new Error("Missing diagram: event-distribution");
    expect(diag).toBeDefined();
    expect(diag.id).toBe("event-distribution");
    expect(diag.nodes.length).toBeGreaterThanOrEqual(4);
    expect(diag.edges.length).toBeGreaterThanOrEqual(3);
  });

  it("registers StandardNode in customNodeTypes", () => {
    expect(customNodeTypes.custom).toBe(StandardNode);
  });

  it("renders StandardNode cleanly with data badges and items", () => {
    const mockProps = {
      id: "node-1",
      data: {
        tag: "Service",
        badge: "Active",
        badgeVariant: "accent" as const,
        title: "Test Service",
        subtitle: "Runs tests",
        code: "test.ts",
        items: ["item 1", "item 2"],
        variant: "service" as const,
      },
      type: "custom",
      selected: false,
      zIndex: 1,
      isConnectable: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      dragging: false,
      draggable: false,
      selectable: false,
      deletable: false,
    };

    const html = renderToString(
      React.createElement(
        ReactFlowProvider,
        null,
        React.createElement(
          StandardNode,
          mockProps as unknown as Parameters<typeof StandardNode>[0],
        ),
      ),
    );
    expect(html).toContain("Test Service");
    expect(html).toContain("Runs tests");
    expect(html).toContain("test.ts");
    expect(html).toContain("item 1");
    expect(html).toContain("item 2");
    expect(html).toContain("flow-node-service");
  });

  it("renders FlowDiagramViewer fallback cleanly in SSR / test mode", () => {
    const html = renderToString(
      React.createElement(FlowDiagramViewer, {
        diagramId: "process-boundaries",
      }),
    );
    expect(html).toContain("Process Boundaries &amp; System Topology");
    expect(html).toContain("Interactive Architecture Diagram");
  });

  it("renders FlowDiagramViewer missing state when diagramId does not exist", () => {
    const html = renderToString(
      React.createElement(FlowDiagramViewer, {
        diagramId: "non-existent-diagram",
      }),
    );
    expect(html).toContain("Diagram not found");
  });
});
