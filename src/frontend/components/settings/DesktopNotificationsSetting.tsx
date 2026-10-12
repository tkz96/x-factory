// src/frontend/components/settings/DesktopNotificationsSetting.tsx — The Desktop notifications
// switch in Settings (#265, spec #241). Off by default; disabled with one line of reason when
// the browser lacks the API or has blocked permission.
//
// It is the Notifications group of Settings › General: the switch trails
// the row's title, and the reason a switch is blocked is the group's footer.

import { useDesktopNotifications } from "../../hooks/useDesktopNotifications.js";
import { desktopSupportReason } from "../../lib/desktop-notifications.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";
import { SwitchControl } from "../ui/SwitchControl.js";

/** What the switch turns on, when nothing is blocking it. */
const DESCRIPTION =
  "Show a banner when a run needs you or finishes, while X-Factory is in the background.";

export function DesktopNotificationsSetting() {
  const { ready, enabled, support, enable, disable } =
    useDesktopNotifications();
  const reason = desktopSupportReason(support);
  const isOn = enabled && support === "granted";

  return (
    <ListGroup
      title="Notifications"
      {...(reason !== null ? { footer: reason } : {})}
    >
      <ListGroupRow
        title="Desktop notifications"
        {...(reason === null ? { subtitle: DESCRIPTION } : {})}
        trailing={
          <SwitchControl
            label="Desktop notifications"
            hideLabel
            isSelected={isOn}
            isDisabled={!ready || reason !== null}
            onChange={(next) => {
              if (next) void enable();
              else disable();
            }}
          />
        }
      />
    </ListGroup>
  );
}
