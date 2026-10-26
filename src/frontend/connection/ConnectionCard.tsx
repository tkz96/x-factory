// src/frontend/connection/ConnectionCard.tsx — Role-based connection card (spec #126, #130, #133, #143).

import type React from "react";
import type { ProjectConnectionRole } from "../../shared/types.js";
import { Card } from "../components/ui/Card.js";
import { ConnectionCardHeader } from "./ConnectionCardHeader.js";
import { ConnectionFieldsList } from "./ConnectionFieldsList.js";
import { ConnectionProviderSelect } from "./ConnectionProviderSelect.js";
import type { ProviderDescriptor, VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionCardProps {
  connectionRole: ProjectConnectionRole;
  providerId: string | null;
  title: string;
  manifest: ProviderDescriptor[];
  config: Record<string, unknown>;
  onSelectProvider: (providerId: string | null) => void;
  onConfigChange: (fieldName: string, value: unknown) => void;
  onVerify: () => void;
  verificationStatus: "idle" | "pending" | "ok" | "degraded" | "error";
  verificationResult?: VerificationResult | null | undefined;
  verificationError?: unknown | null | undefined;
  fieldErrors?: Record<string, string> | null | undefined;
  formErrors?: string[] | null | undefined;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function ConnectionCard({
  connectionRole,
  providerId,
  title,
  manifest,
  config,
  onSelectProvider,
  onConfigChange,
  onVerify,
  verificationStatus,
  verificationResult,
  verificationError,
  fieldErrors,
  formErrors,
  disabled = false,
  children,
}: ConnectionCardProps) {
  const selectedProvider = manifest.find((p) => p.id === providerId);
  const isPending = verificationStatus === "pending";

  return (
    /* The element consumers know keeps its id and data-role; inside it the
       connection family of the Card block (#296) draws the frame — the
       hairline, radius and surface. The .connection-slot class keeps the
       card's own bottom offset — a Card owns no margins (DESIGN.md §7
       "Cards"). */
    <div id={`connection-card-${connectionRole}`} data-role={connectionRole}>
      <Card variant="connection" className="connection-slot">
        <ConnectionCardHeader
          title={title}
          providerId={providerId}
          selectedProvider={selectedProvider}
          verificationStatus={verificationStatus}
        />

        <div className="connection-body">
          <ConnectionProviderSelect
            connectionRole={connectionRole}
            providerId={providerId}
            manifest={manifest}
            disabled={disabled}
            onSelectProvider={onSelectProvider}
          />

          <ConnectionFieldsList
            connectionRole={connectionRole}
            selectedProvider={selectedProvider}
            config={config}
            disabled={disabled}
            isPending={isPending}
            verificationStatus={verificationStatus}
            verificationResult={verificationResult}
            verificationError={verificationError}
            fieldErrors={fieldErrors}
            formErrors={formErrors}
            onConfigChange={onConfigChange}
            onVerify={onVerify}
          />

          {children}
        </div>
      </Card>
    </div>
  );
}
