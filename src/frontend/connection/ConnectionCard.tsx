// src/frontend/connection/ConnectionCard.tsx — Connection card for tracker or git-host roles (spec #126, #130).

import "./ConnectionCard.css";

import { ProviderMark } from "./ProviderMark.js";

interface ConnectionCardProps {
  connectionRole: "tracker" | "gitHost";
  providerId: string | null;
  title: string;
  children?: React.ReactNode;
}

export function ConnectionCard({
  connectionRole,
  providerId,
  title,
  children,
}: ConnectionCardProps) {
  return (
    <div
      className="connection-card"
      id={`connection-card-${connectionRole}`}
      data-role={connectionRole}
    >
      <div className="connection-card-header">
        <div className="flex items-center gap-2">
          <ProviderMark providerId={providerId} />
          <h3 className="connection-card-role-title">{title}</h3>
        </div>
      </div>
      <div className="connection-card-body">{children}</div>
    </div>
  );
}
