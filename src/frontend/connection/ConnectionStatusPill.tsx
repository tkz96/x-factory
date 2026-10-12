// src/frontend/connection/ConnectionStatusPill.tsx — Status badge for ConnectionCard.

import "./ConnectionCard.css";

import { Badge } from "../components/ui/Badge.js";

export interface ConnectionStatusPillProps {
  status: "idle" | "pending" | "ok" | "degraded" | "error";
}

export function ConnectionStatusPill({ status }: ConnectionStatusPillProps) {
  if (status === "ok") {
    return <Badge tone="success">Verified</Badge>;
  }
  if (status === "degraded") {
    return <Badge tone="warning">Degraded</Badge>;
  }
  if (status === "pending") {
    return <Badge>Verifying…</Badge>;
  }
  if (status === "error") {
    return <Badge tone="error">Error</Badge>;
  }
  return null;
}
