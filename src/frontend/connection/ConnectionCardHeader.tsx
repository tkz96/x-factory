// src/frontend/connection/ConnectionCardHeader.tsx — Header with icon, title and status pill.

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
  return (
    <div className="connection-header">
      <div className="connection-title-group">
        <ProviderMark
          providerId={providerId}
          iconRef={selectedProvider?.iconRef}
          displayName={selectedProvider?.displayName}
        />
        {/* The title's type comes from the .text-headline style. */}
        <h3 className="connection-role-title text-headline">{title}</h3>
      </div>
      <div className="connection-header-status">
        <ConnectionStatusPill status={verificationStatus} />
      </div>
    </div>
  );
}
