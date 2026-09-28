// src/frontend/components/diagrams/CustomNodes.tsx — Apple HIG custom nodes for React Flow.

import "./CustomNodes.css";

import { Handle, type NodeProps, Position } from "@xyflow/react";

export interface CustomNodeData extends Record<string, unknown> {
  tag?: string;
  badge?: string;
  badgeVariant?: "accent" | "success" | "warning" | "danger";
  title: string;
  subtitle?: string;
  code?: string;
  items?: string[];
  icon?: string;
  variant?:
    | "service"
    | "worker"
    | "db"
    | "client"
    | "agent"
    | "state"
    | "state-pending"
    | "state-claimed"
    | "state-completed"
    | "state-expired";
  hasTopHandle?: boolean;
  hasBottomHandle?: boolean;
  hasLeftHandle?: boolean;
  hasRightHandle?: boolean;
}

export function StandardNode({ data }: NodeProps) {
  const nodeData = data as unknown as CustomNodeData;
  const variantClass = nodeData.variant ? `flow-node-${nodeData.variant}` : "";
  const badgeClass = nodeData.badgeVariant
    ? `badge-${nodeData.badgeVariant}`
    : "";

  const iconVariantClass = nodeData.variant ? `icon-${nodeData.variant}` : "";

  return (
    <div className={`flow-node-card ${variantClass}`}>
      {nodeData.hasTopHandle !== false && (
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          className="flow-handle"
        />
      )}
      {nodeData.hasLeftHandle && (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className="flow-handle"
        />
      )}

      {(nodeData.tag || nodeData.badge) && (
        <div className="flow-node-header">
          {nodeData.tag && (
            <span className="flow-node-tag">{nodeData.tag}</span>
          )}
          {nodeData.badge && (
            <span className={`flow-node-badge ${badgeClass}`}>
              {nodeData.badge}
            </span>
          )}
        </div>
      )}

      <div className="flow-node-title-row">
        {nodeData.icon && (
          <svg
            className={`icon flow-node-icon ${iconVariantClass}`}
            aria-hidden="true"
          >
            <use href={`/assets/icons/sprite.svg#${nodeData.icon}`} />
          </svg>
        )}
        <span className="flow-node-title">{nodeData.title}</span>
      </div>

      {nodeData.subtitle && (
        <span className="flow-node-subtitle">{nodeData.subtitle}</span>
      )}

      {nodeData.code && (
        <code>
          <span className="flow-node-code">{nodeData.code}</span>
        </code>
      )}

      {nodeData.items && nodeData.items.length > 0 && (
        <div className="flow-node-items">
          {nodeData.items.map((item) => (
            <div key={item} className="flow-node-item">
              <span className="flow-node-item-dot" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {nodeData.hasRightHandle && (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className="flow-handle"
        />
      )}
      {nodeData.hasBottomHandle !== false && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          className="flow-handle"
        />
      )}
    </div>
  );
}

export const customNodeTypes = {
  custom: StandardNode,
};
