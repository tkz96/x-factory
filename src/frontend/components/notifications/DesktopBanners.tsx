// src/frontend/components/notifications/DesktopBanners.tsx — Shows desktop banners for live
// notifications (#265, spec #241). It renders nothing. A banner fires only for an event that
// arrived live, when the window isn't focused and the run isn't on screen. A click focuses
// the window and opens the run.

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNotificationCenter } from "../../context/NotificationContext.js";
import { useDesktopNotifications } from "../../hooks/useDesktopNotifications.js";
import {
  desktopSupport,
  notificationApi,
  shouldShowBanner,
  showBanner,
} from "../../lib/desktop-notifications.js";

/** The run whose page is showing, or null. */
export function openRunIdOf(pathname: string): string | null {
  const match = pathname.match(/^\/runs\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function DesktopBanners() {
  const { subscribeLive, markRead } = useNotificationCenter();
  const { enabled } = useDesktopNotifications();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // The listener reads the latest values when an event arrives, not when it was registered.
  const latest = useRef({ enabled, pathname });
  useEffect(() => {
    latest.current = { enabled, pathname };
  }, [enabled, pathname]);

  useEffect(
    () =>
      subscribeLive((notification) => {
        const api = notificationApi();
        if (!api) return;
        const current = latest.current;
        const shouldShow = shouldShowBanner(notification, {
          live: true,
          enabled: current.enabled,
          support: desktopSupport(api),
          documentFocused:
            typeof document !== "undefined" && document.hasFocus(),
          openRunId: openRunIdOf(current.pathname),
        });
        if (!shouldShow) return;
        showBanner(api, notification, () => {
          window.focus();
          markRead(notification.id);
          navigate(`/runs/${encodeURIComponent(notification.runId)}`);
        });
      }),
    [subscribeLive, markRead, navigate],
  );

  return null;
}
