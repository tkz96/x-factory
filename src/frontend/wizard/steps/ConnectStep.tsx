// src/frontend/wizard/steps/ConnectStep.tsx — Step 2: Dual decoupled connection cards (spec #130, #133, #143).
//
// The repository URL is collected on step 1 (#268), which is also where a
// recognised URL pre-fills these cards: this step is only about credentials and
// verification.

import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { WizardFooter } from "../shared/WizardFooter.js";
import { ConnectCardsContainer } from "./ConnectCardsContainer.js";
import { ConnectVerifyAllRow } from "./ConnectVerifyAllRow.js";
import { useConnectStep } from "./useConnectStep.js";
import "./ConnectStep.css";

export function ConnectStep() {
  const {
    manifestQuery,
    manifestAsync,
    manifest,
    connect,
    trackerConn,
    gitHostConn,
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
          Connect where your tickets live and where your code lives.
        </p>
      </div>

      <ConnectVerifyAllRow
        isVisible={Boolean(
          connect.tracker.providerId && connect.gitHost.providerId,
        )}
        isVerifying={isVerifyingAny}
        onVerifyAll={handleVerifyAll}
      />

      <ConnectCardsContainer
        manifest={manifest}
        connect={connect}
        trackerConn={trackerConn}
        gitHostConn={gitHostConn}
        disabled={false}
      />

      <WizardFooter
        step={2}
        onBack={prevStep}
        onNext={handleNext}
        isNextDisabled={!canProceed}
      />
    </div>
  );
}
