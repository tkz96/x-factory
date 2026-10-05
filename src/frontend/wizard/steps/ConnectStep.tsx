// src/frontend/wizard/steps/ConnectStep.tsx — Step 2: Dual decoupled connection cards & Quick-URL (spec #130, #133, #143).

import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { QuickUrlIntake } from "../../connection/QuickUrlIntake.js";
import { ConnectCardsContainer } from "./ConnectCardsContainer.js";
import { ConnectStepFooter } from "./ConnectStepFooter.js";
import { ConnectVerifyAllRow } from "./ConnectVerifyAllRow.js";
import { useConnectStep } from "./useConnectStep.js";
import "./ConnectStep.css";

export function ConnectStep() {
  const {
    manifestQuery,
    manifestAsync,
    manifest,
    tracker,
    gitHost,
    trackerConn,
    gitHostConn,
    quickUrlState,
    handleVerifyAll,
    isVerifyingAny,
    canProceed,
    handleNext,
    prevStep,
  } = useConnectStep();

  if (manifestAsync.state === "loading" || manifestAsync.state === "error") {
    return (
      <div id="onboard-step-2" className="wizard-step-pane connect-step-pane">
        <AsyncRegion
          derived={manifestAsync}
          onRetry={() => manifestQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div id="onboard-step-2" className="wizard-step-pane connect-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Connect Providers</h2>
        <p className="wizard-step-subtitle">
          Connect your Issue Tracker and Git Host. Dual connections are
          decoupled and mandatory.
        </p>
      </div>

      <QuickUrlIntake
        value={quickUrlState.quickUrl}
        onChange={quickUrlState.setQuickUrl}
        onSubmit={quickUrlState.handleQuickUrlSubmit}
        isSubmitting={quickUrlState.isParsingUrl}
        disabled={isVerifyingAny}
        missMessage={quickUrlState.quickUrlMissMessage}
      />

      <ConnectVerifyAllRow
        isVisible={Boolean(tracker.providerId && gitHost.providerId)}
        isVerifying={isVerifyingAny}
        onVerifyAll={handleVerifyAll}
      />

      <ConnectCardsContainer
        manifest={manifest}
        tracker={tracker}
        gitHost={gitHost}
        trackerConn={trackerConn}
        gitHostConn={gitHostConn}
        disabled={quickUrlState.isParsingUrl}
      />

      <ConnectStepFooter
        canProceed={canProceed}
        onPrev={prevStep}
        onNext={handleNext}
      />
    </div>
  );
}
