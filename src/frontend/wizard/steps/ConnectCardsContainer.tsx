// src/frontend/wizard/steps/ConnectCardsContainer.tsx — Container rendering tracker and git host connection cards.

import { ConnectionCard } from "../../connection/ConnectionCard.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import type { WizardConnectionRoleState } from "../types.js";
import type { useRoleConnection } from "./useRoleConnection.js";
import "./ConnectStep.css";

export interface ConnectCardsContainerProps {
  manifest: ProviderDescriptor[];
  tracker: WizardConnectionRoleState;
  gitHost: WizardConnectionRoleState;
  trackerConn: ReturnType<typeof useRoleConnection>;
  gitHostConn: ReturnType<typeof useRoleConnection>;
  disabled?: boolean | undefined;
}

export function ConnectCardsContainer({
  manifest,
  tracker,
  gitHost,
  trackerConn,
  gitHostConn,
  disabled = false,
}: ConnectCardsContainerProps) {
  return (
    <div className="connect-cards-container">
      <ConnectionCard
        connectionRole="tracker"
        providerId={tracker.providerId}
        title="Issue Tracker"
        manifest={manifest}
        config={tracker.config}
        onSelectProvider={trackerConn.selectProvider}
        onConfigChange={trackerConn.updateConfig}
        onVerify={trackerConn.verify}
        verificationStatus={trackerConn.status}
        verificationResult={trackerConn.verification}
        verificationError={trackerConn.error}
        fieldErrors={trackerConn.fieldErrors}
        formErrors={trackerConn.formErrors}
        degradedAccepted={trackerConn.degradedAccepted}
        onAcceptDegraded={trackerConn.acceptDegraded}
        disabled={disabled}
      />

      <ConnectionCard
        connectionRole="gitHost"
        providerId={gitHost.providerId}
        title="Git Host"
        manifest={manifest}
        config={gitHost.config}
        onSelectProvider={gitHostConn.selectProvider}
        onConfigChange={gitHostConn.updateConfig}
        onVerify={gitHostConn.verify}
        verificationStatus={gitHostConn.status}
        verificationResult={gitHostConn.verification}
        verificationError={gitHostConn.error}
        fieldErrors={gitHostConn.fieldErrors}
        formErrors={gitHostConn.formErrors}
        degradedAccepted={gitHostConn.degradedAccepted}
        onAcceptDegraded={gitHostConn.acceptDegraded}
        disabled={disabled}
      />
    </div>
  );
}
