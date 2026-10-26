// src/frontend/connection/ConnectionStatusPill.tsx — Status badge for ConnectionCard.

import "./ConnectionCard.css";

import { STATUS_COPY } from "../components/feedback/copy-map.js";
import { Badge } from "../components/ui/Badge.js";

export interface ConnectionStatusPillProps {
  status: "idle" | "pending" | "ok" | "degraded" | "error";
}

export function ConnectionStatusPill({ status }: ConnectionStatusPillProps) {
  if (status === "ok") {
    return <Badge tone="success">{STATUS_COPY.verified}</Badge>;
  }
  if (status === "degraded") {
    return <Badge tone="warning">{STATUS_COPY.degraded}</Badge>;
  }
  if (status === "pending") {
    return <Badge>{STATUS_COPY.verifying}</Badge>;
  }
  if (status === "error") {
    return <Badge tone="error">{STATUS_COPY.error}</Badge>;
  }
  return null;
}
