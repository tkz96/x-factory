// src/frontend/wizard/steps/ConnectStep.tsx — Step 2: Dual connection cards scaffold (spec #126, #130, #142).

import "./ConnectStep.css";

import { ConnectionCard } from "../../connection/ConnectionCard.js";
import { useWizard } from "../state/wizardContext.js";

export function ConnectStep() {
  const { state, nextStep, prevStep } = useWizard();
  const { tracker, gitHost } = state.connect;

  return (
    <div id="onboard-step-2" className="wizard-step-pane connect-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Connect Providers</h2>
        <p className="wizard-step-subtitle">
          Connect your Issue Tracker and Git Host. Dual connections are
          decoupled and mandatory.
        </p>
      </div>

      <div className="connect-cards-container">
        <ConnectionCard
          connectionRole="tracker"
          providerId={tracker.providerId}
          title="Issue Tracker"
        >
          <p>Configure credentials and project issue tracking.</p>
        </ConnectionCard>

        <ConnectionCard
          connectionRole="gitHost"
          providerId={gitHost.providerId}
          title="Git Host"
        >
          <p>Configure git repository hosting and pull request creation.</p>
        </ConnectionCard>
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          id="btn-step-2-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-2-next"
          className="btn-primary"
          onClick={nextStep}
        >
          Continue to Repositories →
        </button>
      </div>
    </div>
  );
}
