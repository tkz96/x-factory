// src/frontend/connection/ConnectionVerifyButton.tsx — Action button for verifying connection.

import "./ConnectionCard.css";

export interface ConnectionVerifyButtonProps {
  connectionRole: "tracker" | "gitHost";
  status: "idle" | "pending" | "ok" | "degraded" | "error";
  disabled: boolean;
  onVerify: () => void;
}

export function ConnectionVerifyButton({
  connectionRole,
  status,
  disabled,
  onVerify,
}: ConnectionVerifyButtonProps) {
  const isPending = status === "pending";

  return (
    <div className="connection-card-actions">
      <button
        type="button"
        id={`btn-verify-${connectionRole}`}
        className="btn-secondary btn-sm"
        onClick={onVerify}
        disabled={disabled}
      >
        {isPending ? (
          <>
            <svg className="icon icon-sm icon-spin" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-loader-2" />
            </svg>
            Verifying…
          </>
        ) : status === "ok" ? (
          "Re-verify"
        ) : (
          "Verify Connection"
        )}
      </button>
    </div>
  );
}
