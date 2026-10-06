// src/frontend/connection/ConnectionCard.tsx — Role-based connection card (spec #126, #130, #133, #143).

import type React from "react";
import { ConnectionCardHeader } from "./ConnectionCardHeader.js";
import { ConnectionFieldsList } from "./ConnectionFieldsList.js";
import { ConnectionProviderSelect } from "./ConnectionProviderSelect.js";
import type { ProviderDescriptor, VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionCardProps {
  connectionRole: "tracker" | "gitHost";
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
    <div
      className="connection-card"
      id={`connection-card-${connectionRole}`}
      data-role={connectionRole}
    >
      <ConnectionCardHeader
        title={title}
        providerId={providerId}
        selectedProvider={selectedProvider}
        verificationStatus={verificationStatus}
      />

      <div className="connection-card-body">
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
    </div>
  );
}
