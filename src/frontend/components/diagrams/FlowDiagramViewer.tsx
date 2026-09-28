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
      <button
        type="button"
        className="flow-btn-tool"
        onClick={() => fitView({ padding: 0.2, duration: 250 })}
        title="Fit diagram to viewport"
      >
        <svg className="icon" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-refresh-cw" />
        </svg>
        <span>Fit</span>
      </button>
      <button
        type="button"
        className="flow-btn-tool"
        onClick={() => zoomIn({ duration: 250 })}
        title="Zoom in"
      >
        <span>+</span>
      </button>
      <button
        type="button"
        className="flow-btn-tool"
        onClick={() => zoomOut({ duration: 250 })}
        title="Zoom out"
      >
        <span>−</span>
      </button>
      <button
        type="button"
        className="flow-btn-tool"
        onClick={onExpand}
        title="Expand diagram to full screen"
      >
        <svg className="icon" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-external-link" />
        </svg>
        <span>Expand</span>
      </button>
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
            <span className="flow-diagram-badge">Architecture</span>
            <span className="flow-diagram-title">{diagram.title}</span>
          </div>
          <span className="flow-diagram-subtitle">{diagram.subtitle}</span>
        </div>
        <DiagramToolbar onExpand={onExpand} />
      </div>

      <div className="flow-canvas-wrapper">
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
  const { theme } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const diagram = DIAGRAM_REGISTRY[diagramId];

  if (!diagram) {
    return (
      <div className="flow-fallback-card">
        <span className="flow-fallback-title">Diagram not found</span>
        <p className="flow-fallback-desc">
          Unknown architecture diagram ID: <code>{diagramId}</code>
        </p>
      </div>
    );
  }

  // SSR fallback: In non-browser / static render, output clean semantic fallback
  if (!isMounted || typeof window === "undefined") {
    return (
      <div className="flow-fallback-card">
        <span className="flow-fallback-title">{diagram.title}</span>
        <p className="flow-fallback-desc">{diagram.subtitle}</p>
        <span className="code-sub">Interactive Architecture Diagram</span>
      </div>
    );
  }

  const colorMode: "dark" | "light" = theme === "light" ? "light" : "dark";

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
