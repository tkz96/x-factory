// src/frontend/components/diagrams/DiagramModal.tsx — Expanded Fullscreen Modal for technical diagram inspection.

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { Dialog } from "../overlays/Dialog.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
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
  return (
    <Dialog
      isOpen
      onClose={onClose}
      id="flow-modal"
      overlayId="flow-modal-backdrop"
      overlayClassName="flow-modal-backdrop"
      ariaLabelledBy="flow-modal-heading"
      className="flow-modal-container"
    >
      <div className="flow-modal-header">
        <div>
          <Badge tone="accent" className="flow-diagram-badge">
            Detailed Inspection
          </Badge>
          <h3
            id="flow-modal-heading"
            className="flow-diagram-title text-headline"
          >
            {diagram.title}
          </h3>
          <span className="flow-diagram-subtitle text-subhead">
            {diagram.subtitle}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          title="Close modal (Esc)"
        >
          <span>Close</span>
          <kbd className="code-sub text-footnote">Esc</kbd>
        </Button>
      </div>

      <div className="flow-modal-canvas text-caption-1">
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
          <MiniMap nodeColor="var(--accent)" maskColor="var(--scrim)" />
        </ReactFlow>
      </div>
    </Dialog>
  );
}
