// src/frontend/connection/ConnectionVerifyButton.tsx — Action button for verifying connection.

import type { ProjectConnectionRole } from "../../shared/types.js";
import { Button } from "../components/ui/Button.js";
import "./ConnectionCard.css";

export interface ConnectionVerifyButtonProps {
  connectionRole: ProjectConnectionRole;
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
      <Button
        id={`btn-verify-${connectionRole}`}
        variant="secondary"
        size="sm"
        isDisabled={disabled}
        onPress={onVerify}
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
      </Button>
    </div>
  );
}
