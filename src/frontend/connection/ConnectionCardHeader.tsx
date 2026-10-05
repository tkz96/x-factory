// src/frontend/connection/ConnectionCardHeader.tsx — Header with icon, title, badge, and status pill.

import { ConnectionStatusPill } from "./ConnectionStatusPill.js";
import { ProviderMark } from "./ProviderMark.js";
import type { ProviderDescriptor } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionCardHeaderProps {
  title: string;
  providerId: string | null;
  selectedProvider?: ProviderDescriptor | undefined;
  verificationStatus: "idle" | "pending" | "ok" | "degraded" | "error";
}

export function ConnectionCardHeader({
  title,
  providerId,
  selectedProvider,
  verificationStatus,
}: ConnectionCardHeaderProps) {
  const isDualRole = Boolean(
    selectedProvider?.roles.includes("tracker") &&
      selectedProvider?.roles.includes("gitHost"),
  );

  return (
    <div className="connection-card-header">
      <div className="connection-card-title-group">
        <ProviderMark
          providerId={providerId}
          iconRef={selectedProvider?.iconRef}
          displayName={selectedProvider?.displayName}
        />
        <h3 className="connection-card-role-title">{title}</h3>
        {isDualRole && (
          <span className="badge badge-secondary dual-role-badge">
            Dual-role
          </span>
        )}
      </div>
      <div className="connection-card-header-status">
        <ConnectionStatusPill status={verificationStatus} />
      </div>
    </div>
  );
}
