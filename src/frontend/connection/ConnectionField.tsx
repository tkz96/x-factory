// src/frontend/connection/ConnectionField.tsx — Generic field renderer driven by ProviderConfigFieldDescriptor (spec #133, ticket #143).

import type { ChangeEvent } from "react";
import { FieldFeedback } from "../components/feedback/FieldFeedback.js";
import type { ProviderConfigFieldDescriptor } from "./types.js";
import "./ConnectionField.css";

export interface ConnectionFieldProps {
  descriptor: ProviderConfigFieldDescriptor;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  error?: string | null;
  id?: string;
}

export function ConnectionField({
  descriptor,
  value,
  onChange,
  onBlur,
  disabled = false,
  error,
  id,
}: ConnectionFieldProps) {
  const fieldId = id ?? `field-${descriptor.name}`;
  const hintId = descriptor.help ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const isSecret = descriptor.type === "secret" || descriptor.secret === true;
  const inputType = isSecret
    ? "password"
    : descriptor.type === "url"
      ? "url"
      : descriptor.type === "email"
        ? "email"
        : "text";

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="wizard-form-group connection-field-group">
      <label htmlFor={fieldId} className="wizard-form-label">
        {descriptor.label}
        {descriptor.required && <span className="required"> *</span>}
      </label>
      <input
        id={fieldId}
        name={descriptor.name}
        type={inputType}
        className={`form-input${isSecret ? " code-input" : ""}`}
        placeholder={descriptor.placeholder}
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        disabled={disabled}
        required={descriptor.required}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        autoComplete={isSecret ? "new-password" : "off"}
      />
      {descriptor.help && (
        <span id={hintId} className="wizard-form-hint">
          {descriptor.help}
        </span>
      )}
      {error && (
        <FieldFeedback
          {...(errorId ? { id: errorId } : {})}
          state="invalid"
          message={error}
        />
      )}
    </div>
  );
}
