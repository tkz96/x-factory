// src/frontend/components/notifications/DesktopNotificationPrompt.tsx — The bell's one-time
// row offering desktop notifications (#265, spec #241). It appears the first time a run needs
// the user, and never asks for permission on its own: Enable is the user action.

import { useState } from "react";
import { useDesktopNotifications } from "../../hooks/useDesktopNotifications.js";
import {
  markPromptAnswered,
  promptAnswered,
  shouldOfferDesktopPrompt,
} from "../../lib/desktop-notifications.js";
import { OverlayTriggerButton } from "../overlays/index.js";

export function DesktopNotificationPrompt({
  hasNeedsYou,
}: {
  hasNeedsYou: boolean;
}) {
  const { ready, enabled, support, enable } = useDesktopNotifications();
  const [answered, setAnswered] = useState(() => promptAnswered());

  const visible =
    ready &&
    shouldOfferDesktopPrompt({
      enabled,
      support,
      alreadyOffered: answered,
      hasNeedsYou,
    });
  if (!visible) return null;

  const answer = () => {
    markPromptAnswered();
    setAnswered(true);
  };

  return (
    <section className="notification-prompt" aria-label="Desktop notifications">
      <p className="notification-prompt-text">
        Get desktop notifications when a run needs you
      </p>
      <div className="notification-prompt-actions">
        <OverlayTriggerButton
          className="btn-primary btn-sm"
          onPress={() => {
            answer();
            enable().catch(() => undefined);
          }}
        >
          Enable
        </OverlayTriggerButton>
        <OverlayTriggerButton className="btn-secondary btn-sm" onPress={answer}>
          Not Now
        </OverlayTriggerButton>
      </div>
    </section>
  );
}
