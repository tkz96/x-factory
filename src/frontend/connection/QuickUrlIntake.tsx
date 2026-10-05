// src/frontend/connection/QuickUrlIntake.tsx — Quick-URL intake form component (spec #133, ticket #143).

import type { KeyboardEvent } from "react";
import { FieldFeedback } from "../components/feedback/FieldFeedback.js";
import "./QuickUrlIntake.css";

export interface QuickUrlIntakeProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (url: string) => void;
  isSubmitting?: boolean;
  disabled?: boolean;
  missMessage?: string | null;
}

export function QuickUrlIntake({
  value,
  onChange,
  onSubmit,
  isSubmitting = false,
  disabled = false,
  missMessage,
}: QuickUrlIntakeProps) {
  const handleSubmit = () => {
    if (!value.trim() || isSubmitting || disabled) return;
    onSubmit(value.trim());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="quick-url-intake">
      <label htmlFor="connect-quick-url" className="wizard-form-label">
        Quick-URL Intake
      </label>
      <div className="quick-url-input-row">
        <input
          id="connect-quick-url"
          type="url"
          className="form-input quick-url-input"
          placeholder="e.g. https://github.com/owner/repo or https://dev.azure.com/org/project"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
        />
        <button
          type="button"
          id="btn-quick-url-submit"
          className="btn-secondary"
          onClick={handleSubmit}
          disabled={disabled || isSubmitting || !value.trim()}
        >
          {isSubmitting ? (
            <>
              <svg className="icon icon-sm icon-spin" aria-hidden="true">
                <use href="/assets/icons/sprite.svg#icon-loader-2" />
              </svg>
              Parsing…
            </>
          ) : (
            "Parse URL"
          )}
        </button>
      </div>
      <span className="wizard-form-hint">
        Paste a repository or project URL to automatically select and prefill
        connection settings.
      </span>
      {missMessage && (
        <FieldFeedback
          state="warning"
          message={missMessage}
          id="quick-url-miss-feedback"
        />
      )}
    </div>
  );
}
