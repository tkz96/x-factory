// src/frontend/wizard/steps/ConnectVerifyAllRow.tsx — Verify All button row.

import { Button } from "../../components/ui/Button.js";
import "./ConnectStep.css";

export interface ConnectVerifyAllRowProps {
  isVisible: boolean;
  isVerifying: boolean;
  onVerifyAll: () => void;
}

export function ConnectVerifyAllRow({
  isVisible,
  isVerifying,
  onVerifyAll,
}: ConnectVerifyAllRowProps) {
  if (!isVisible) return null;

  return (
    <div className="connect-verify-all-row">
      <Button
        id="btn-verify-all"
        variant="secondary"
        size="sm"
        isDisabled={isVerifying}
        onPress={onVerifyAll}
      >
        {isVerifying ? (
          <>
            <svg className="icon icon-sm icon-spin" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-loader-2" />
            </svg>
            Verifying Connections…
          </>
        ) : (
          "Verify All Connections"
        )}
      </Button>
    </div>
  );
}
