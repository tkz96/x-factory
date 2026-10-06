// src/frontend/connection/ConnectionFieldsList.tsx — Config fields, feedback, and action button.

import { ConnectionCardFeedback } from "./ConnectionCardFeedback.js";
import { ConnectionField } from "./ConnectionField.js";
import { ConnectionVerifyButton } from "./ConnectionVerifyButton.js";
import { formatFieldError } from "./format-field-error.js";
import type { ProviderDescriptor, VerificationResult } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionFieldsListProps {
  connectionRole: "tracker" | "gitHost";
  selectedProvider?: ProviderDescriptor | undefined;
  config: Record<string, unknown>;
  disabled: boolean;
  isPending: boolean;
  verificationStatus: "idle" | "pending" | "ok" | "degraded" | "error";
  verificationResult?: VerificationResult | null | undefined;
  verificationError?: unknown | null | undefined;
  fieldErrors?: Record<string, string> | null | undefined;
  formErrors?: string[] | null | undefined;
  onConfigChange: (fieldName: string, value: unknown) => void;
  onVerify: () => void;
}

export function ConnectionFieldsList({
  connectionRole,
  selectedProvider,
  config,
  disabled,
  isPending,
  verificationStatus,
  verificationResult,
  verificationError,
  fieldErrors,
  formErrors,
  onConfigChange,
  onVerify,
}: ConnectionFieldsListProps) {
  if (!selectedProvider) {
    return (
      <p className="connection-card-empty-prompt">
        Select a provider to configure connection details.
      </p>
    );
  }

  const roleFields = selectedProvider.configFields.filter(
    (f) => !f.roles || f.roles.length === 0 || f.roles.includes(connectionRole),
  );

  const hasFormErrors = Boolean(formErrors && formErrors.length > 0);
  const hasFieldErrors = Boolean(
    fieldErrors && Object.keys(fieldErrors).length > 0,
  );
  const isVerifyDisabled = disabled || isPending;

  return (
    <div className="connection-card-fields">
      {roleFields.map((field) => {
        const fieldError = fieldErrors?.[field.name];
        return (
          <ConnectionField
            key={field.name}
            id={`${connectionRole}-${field.name}`}
            descriptor={field}
            value={String(config[field.name] ?? "")}
            onChange={(val) => onConfigChange(field.name, val)}
            disabled={disabled}
            error={
              fieldError ? formatFieldError(fieldError, field.label) : null
            }
          />
        );
      })}

      <ConnectionCardFeedback
        connectionRole={connectionRole}
        verificationStatus={verificationStatus}
        verificationResult={verificationResult}
        verificationError={verificationError}
        hasFormErrors={hasFormErrors}
        hasFieldErrors={hasFieldErrors}
        formErrors={formErrors}
        onVerify={onVerify}
      />

      <ConnectionVerifyButton
        connectionRole={connectionRole}
        status={verificationStatus}
        disabled={isVerifyDisabled}
        onVerify={onVerify}
      />
    </div>
  );
}
