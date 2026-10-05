// src/frontend/wizard/shared/ComboSummary.tsx — Combined provider summary line (spec #126, #130, #142).

import "./ComboSummary.css";

import { useWizard } from "../state/wizardContext.js";

export function ComboSummary() {
  const { state } = useWizard();
  const tracker = state.connect.tracker.providerId || "Unconnected";
  const gitHost = state.connect.gitHost.providerId || "Unconnected";

  return (
    <div className="combo-summary-container" id="wizard-combo-summary">
      <span className="combo-summary-label">Tracker:</span>
      <span className="combo-summary-value">{tracker}</span>
      <span className="combo-summary-separator">·</span>
      <span className="combo-summary-label">Git host:</span>
      <span className="combo-summary-value">{gitHost}</span>
    </div>
  );
}
