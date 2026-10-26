// src/frontend/components/diagrams/FlowDiagramViewer.tsx — Responsive technical diagram viewer powered by React Flow.

import "./FlowDiagramViewer.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useState } from "react";
import { useTheme } from "../../hooks/useTheme.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { customNodeTypes } from "./CustomNodes.js";
import { DiagramModal } from "./DiagramModal.js";
import { DIAGRAM_REGISTRY, type DiagramDefinition } from "./registry.js";

interface DiagramToolbarProps {
  onExpand: () => void;
}

function DiagramToolbar({ onExpand }: DiagramToolbarProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  return (
    <div className="flow-diagram-actions">
      <Button
        variant="secondary"
        size="sm"
        icon="icon-refresh-cw"
        onPress={() => fitView({ padding: 0.2, duration: 250 })}
        title="Fit diagram to viewport"
      >
        Fit
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => zoomIn({ duration: 250 })}
        title="Zoom in"
      >
        +
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => zoomOut({ duration: 250 })}
        title="Zoom out"
      >
        −
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon="icon-external-link"
        onPress={onExpand}
        title="Expand diagram to full screen"
      >
        Expand
      </Button>
    </div>
  );
}

interface InnerFlowCanvasProps {
  diagram: DiagramDefinition;
  colorMode: "dark" | "light";
  onExpand: () => void;
}

function InnerFlowCanvas({
  diagram,
  colorMode,
  onExpand,
}: InnerFlowCanvasProps) {
  return (
    <div className="flow-diagram-container">
      <div className="flow-diagram-header">
        <div className="flow-diagram-info">
          <div className="flow-diagram-title-row">
            <Badge tone="accent" className="flow-diagram-badge">
              Architecture
            </Badge>
            <span className="flow-diagram-title text-headline">
              {diagram.title}
            </span>
          </div>
          <span className="flow-diagram-subtitle text-subhead">
            {diagram.subtitle}
          </span>
        </div>
        <DiagramToolbar onExpand={onExpand} />
      </div>

      <div className="flow-canvas-wrapper text-caption-1">
        <ReactFlow
          nodes={diagram.nodes}
          edges={diagram.edges}
          nodeTypes={customNodeTypes}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          panOnDrag={true}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--border)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export interface FlowDiagramViewerProps {
  diagramId: string;
}

export function FlowDiagramViewer({ diagramId }: FlowDiagramViewerProps) {
  const { resolvedAppearance } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const diagram = DIAGRAM_REGISTRY[diagramId];

  if (!diagram) {
    return (
      <Card variant="flow" className="flow-fallback">
        <span className="flow-fallback-title text-headline">
          Diagram not found
        </span>
        <p className="flow-fallback-desc text-callout">
          Unknown architecture diagram ID: <code>{diagramId}</code>
        </p>
      </Card>
    );
  }

  // SSR fallback: In non-browser / static render, output clean semantic fallback
  if (!isMounted || typeof window === "undefined") {
    return (
      <Card variant="flow" className="flow-fallback">
        <span className="flow-fallback-title text-headline">
          {diagram.title}
        </span>
        <p className="flow-fallback-desc text-callout">{diagram.subtitle}</p>
        <span className="code-sub text-footnote">
          Interactive Architecture Diagram
        </span>
      </Card>
    );
  }

  const colorMode: "dark" | "light" = resolvedAppearance;

  return (
    <>
      <ReactFlowProvider>
        <InnerFlowCanvas
          diagram={diagram}
          colorMode={colorMode}
          onExpand={() => setIsExpanded(true)}
        />
      </ReactFlowProvider>

      {isExpanded && (
        <ReactFlowProvider>
          <DiagramModal
            diagram={diagram}
            colorMode={colorMode}
            onClose={() => setIsExpanded(false)}
          />
        </ReactFlowProvider>
      )}
    </>
  );
}
