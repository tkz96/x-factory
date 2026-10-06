// src/frontend/wizard/steps/ConnectCardsContainer.tsx — Container rendering tracker and git host connection cards.

import { ConnectionCard } from "../../connection/ConnectionCard.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import type { WizardConnectState } from "../types.js";
import { roleConfig } from "../state/connectConfig.js";
import type { useRoleConnection } from "./useRoleConnection.js";
import "./ConnectStep.css";

export interface ConnectCardsContainerProps {
  manifest: ProviderDescriptor[];
  connect: WizardConnectState;
  trackerConn: ReturnType<typeof useRoleConnection>;
  gitHostConn: ReturnType<typeof useRoleConnection>;
  disabled?: boolean | undefined;
}

export function ConnectCardsContainer({
  manifest,
  connect,
  trackerConn,
  gitHostConn,
  disabled = false,
}: ConnectCardsContainerProps) {
  const { tracker, gitHost } = connect;
  return (
    <div className="connect-cards-container">
      <ConnectionCard
        connectionRole="tracker"
        providerId={tracker.providerId}
        title="Issue Tracker"
        manifest={manifest}
        // The configuration of the provider this card selected — the SAME
        // record the git-host card reads when both name one provider.
        config={roleConfig(connect, "tracker")}
        onSelectProvider={trackerConn.selectProvider}
        onConfigChange={trackerConn.updateConfig}
        onVerify={trackerConn.verify}
        verificationStatus={trackerConn.status}
        verificationResult={trackerConn.verification}
        verificationError={trackerConn.error}
        fieldErrors={trackerConn.fieldErrors}
        formErrors={trackerConn.formErrors}
        disabled={disabled}
      />

      <ConnectionCard
        connectionRole="gitHost"
        providerId={gitHost.providerId}
        title="Git Host"
        manifest={manifest}
        config={roleConfig(connect, "gitHost")}
        onSelectProvider={gitHostConn.selectProvider}
        onConfigChange={gitHostConn.updateConfig}
        onVerify={gitHostConn.verify}
        verificationStatus={gitHostConn.status}
        verificationResult={gitHostConn.verification}
        verificationError={gitHostConn.error}
        fieldErrors={gitHostConn.fieldErrors}
        formErrors={gitHostConn.formErrors}
        disabled={disabled}
      />
    </div>
  );
}
