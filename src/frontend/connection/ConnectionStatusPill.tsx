// src/frontend/connection/ConnectionStatusPill.tsx — Status badge for ConnectionCard.

import "./ConnectionCard.css";

export interface ConnectionStatusPillProps {
  status: "idle" | "pending" | "ok" | "degraded" | "error";
}

export function ConnectionStatusPill({ status }: ConnectionStatusPillProps) {
  if (status === "ok") {
    return <span className="connection-status-pill status-ok">Verified</span>;
  }
  if (status === "degraded") {
    return (
      <span className="connection-status-pill status-degraded">Degraded</span>
    );
  }
  if (status === "pending") {
    return (
      <span className="connection-status-pill status-pending">Verifying…</span>
    );
  }
  if (status === "error") {
    return <span className="connection-status-pill status-error">Error</span>;
  }
  return null;
}
