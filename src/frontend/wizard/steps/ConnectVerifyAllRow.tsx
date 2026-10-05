// src/frontend/wizard/steps/ConnectVerifyAllRow.tsx — Verify All button row.

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
      <button
        type="button"
        id="btn-verify-all"
        className="btn-secondary btn-sm"
        onClick={onVerifyAll}
        disabled={isVerifying}
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
      </button>
    </div>
  );
}
