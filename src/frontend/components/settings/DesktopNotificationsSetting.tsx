// src/frontend/components/settings/DesktopNotificationsSetting.tsx — The Desktop notifications
// switch in Settings (#265, spec #241). Off by default; disabled with one line of reason when
// the browser lacks the API or has blocked permission.

import { useDesktopNotifications } from "../../hooks/useDesktopNotifications.js";
import { desktopSupportReason } from "../../lib/desktop-notifications.js";
import { SwitchControl } from "../ui/SwitchControl.js";

export function DesktopNotificationsSetting() {
  const { ready, enabled, support, enable, disable } =
    useDesktopNotifications();
  const reason = desktopSupportReason(support);
  const isOn = enabled && support === "granted";

  return (
    <SwitchControl
      label="Desktop notifications"
      description={
        reason ??
        "Show a banner when a run needs you or finishes, while X-Factory is in the background."
      }
      isSelected={isOn}
      isDisabled={!ready || reason !== null}
      onChange={(next) => {
        if (next) void enable();
        else disable();
      }}
    />
  );
}
