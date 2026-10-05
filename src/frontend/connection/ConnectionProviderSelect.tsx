// src/frontend/connection/ConnectionProviderSelect.tsx — Provider dropdown selector for ConnectionCard.

import type { ProviderDescriptor } from "./types.js";
import "./ConnectionCard.css";

export interface ConnectionProviderSelectProps {
  connectionRole: "tracker" | "gitHost";
  providerId: string | null;
  manifest: ProviderDescriptor[];
  disabled: boolean;
  onSelectProvider: (providerId: string | null) => void;
}

export function ConnectionProviderSelect({
  connectionRole,
  providerId,
  manifest,
  disabled,
  onSelectProvider,
}: ConnectionProviderSelectProps) {
  const availableProviders = manifest.filter((p) =>
    p.roles.includes(connectionRole),
  );

  return (
    <div className="wizard-form-group">
      <label
        htmlFor={`select-${connectionRole}-provider`}
        className="wizard-form-label"
      >
        Provider <span className="required">*</span>
      </label>
      <select
        id={`select-${connectionRole}-provider`}
        className="form-select"
        value={providerId ?? ""}
        onChange={(e) => onSelectProvider(e.target.value || null)}
        disabled={disabled}
      >
        <option value="">Select a provider…</option>
        {availableProviders.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
