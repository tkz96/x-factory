// src/frontend/components/diagrams/DiagramModal.tsx — Expanded Fullscreen Modal for technical diagram inspection.

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { useEffect } from "react";
import { customNodeTypes } from "./CustomNodes.js";
import type { DiagramDefinition } from "./registry.js";

interface DiagramModalProps {
  diagram: DiagramDefinition;
  colorMode: "dark" | "light";
  onClose: () => void;
}

export function DiagramModal({
  diagram,
  colorMode,
  onClose,
}: DiagramModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="flow-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="flow-modal-heading"
      tabIndex={-1}
    >
      <div className="flow-modal-container">
        <div className="flow-modal-header">
          <div>
            <span className="flow-diagram-badge">Detailed Inspection</span>
            <h3 id="flow-modal-heading" className="flow-diagram-title">
              {diagram.title}
            </h3>
            <span className="flow-diagram-subtitle">{diagram.subtitle}</span>
          </div>
          <button
            type="button"
            className="flow-modal-close-btn"
            onClick={onClose}
            title="Close modal (Esc)"
          >
            <span>Close</span>
            <kbd className="code-sub">Esc</kbd>
          </button>
        </div>

        <div className="flow-modal-canvas">
          <ReactFlow
            nodes={diagram.nodes}
            edges={diagram.edges}
            nodeTypes={customNodeTypes}
            colorMode={colorMode}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={true}
            panOnScroll={false}
            panOnDrag={true}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="var(--border)"
            />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="var(--accent)" maskColor="rgba(0, 0, 0, 0.4)" />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
