// src/frontend/components/feedback/FieldFeedback.tsx — Inline input feedback
// with valid / invalid / warning / indeterminate states (#135, resolution
// #132). Rendered inline in its region with `role="status"` semantics — the
// consumer wires `id` to the input's `aria-describedby`.

import type { FieldFeedbackState } from "./types.js";
import "./FieldFeedback.css";

const FIELD_FEEDBACK_ICONS: Readonly<
  Record<Exclude<FieldFeedbackState, "default">, string>
> = {
  valid: "icon-check-circle-2",
  invalid: "icon-x-circle",
  warning: "icon-alert-circle",
  indeterminate: "icon-info",
};

export interface FieldFeedbackProps {
  state: FieldFeedbackState;
  message?: string;
  /** Wired by the consumer to the input's `aria-describedby`. */
  id?: string;
}

export function FieldFeedback({ state, message, id }: FieldFeedbackProps) {
  if (state === "default") {
    return null;
  }
  return (
    <div
      id={id}
      className={`field-feedback field-feedback--${state}`}
      role="status"
    >
      <svg className="icon icon-sm" aria-hidden="true">
        <use href={`/assets/icons/sprite.svg#${FIELD_FEEDBACK_ICONS[state]}`} />
      </svg>
      {message !== undefined && (
        <span className="field-feedback-message">{message}</span>
      )}
    </div>
  );
}
