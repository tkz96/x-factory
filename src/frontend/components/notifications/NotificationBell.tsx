// src/frontend/components/notifications/NotificationBell.tsx — The toolbar bell and its
// notification list (#264, spec #241). A popover, not a toast: it opens from the bell,
// closes on Escape or on choosing an item, and returns focus to the bell.

import "./NotificationBell.css";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type NotificationListItem,
  useNotificationCenter,
} from "../../context/NotificationContext.js";
import {
  formatRelativeTime,
  formatTimestamp,
} from "../../lib/format-timestamp.js";
import {
  OverlayTriggerButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../overlays/index.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { DesktopNotificationPrompt } from "./DesktopNotificationPrompt.js";

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotificationCenter();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // The badge animates on arrival only: when the count goes from none to some
  // while the page is open. A count the page opened with (already there on the
  // first paint, or arriving with the first load) is simply shown, and a count
  // that ticks up never re-animates.
  const [arriving, setArriving] = useState(false);
  const previousCount = useRef(unreadCount);
  const hasShownACount = useRef(false);
  useEffect(() => {
    const was = previousCount.current;
    previousCount.current = unreadCount;
    if (unreadCount === 0) {
      setArriving(false);
      return;
    }
    if (hasShownACount.current && was === 0) setArriving(true);
    hasShownACount.current = true;
  }, [unreadCount]);

  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  const choose = (item: NotificationListItem) => {
    markRead(item.id);
    setOpen(false);
    navigate(`/runs/${encodeURIComponent(item.runId)}`);
  };

  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <IconButton
        variant="plain"
        icon="icon-bell"
        label={label}
        className={
          arriving
            ? "notification-bell notification-bell--arriving"
            : "notification-bell"
        }
      >
        {unreadCount > 0 && (
          <Badge tone="accent" className="notification-badge">
            {unreadCount}
          </Badge>
        )}
      </IconButton>
      <Popover placement="bottom end" className="notification-popover">
        <PopoverContent aria-label="Notifications">
          <DesktopNotificationPrompt />
          <div className="notification-popover-head">
            <h2 className="notification-popover-title">Notifications</h2>
            <Button
              variant="quiet"
              size="sm"
              isDisabled={unreadCount === 0}
              onPress={markAllRead}
            >
              Mark All as Read
            </Button>
          </div>
          {notifications.length === 0 ? (
            <p className="notification-empty">No notifications yet.</p>
          ) : (
            <ul className="notification-list">
              {notifications.map((item) => (
                <li key={item.id} className="notification-row">
                  <OverlayTriggerButton
                    className="notification-item"
                    onPress={() => choose(item)}
                  >
                    <span className="notification-item-main">
                      <span className="notification-item-title">
                        {item.text}
                      </span>
                      <span className="notification-item-ticket">
                        {item.ticketId} · {item.ticketTitle}
                      </span>
                      {item.detail && (
                        <span className="notification-item-detail">
                          {item.detail}
                        </span>
                      )}
                      <span className="notification-item-meta">
                        {item.projectName} ·{" "}
                        <time
                          dateTime={item.time}
                          title={formatTimestamp(item.time)}
                        >
                          {formatRelativeTime(item.time)}
                        </time>
                      </span>
                    </span>
                    {item.unread && (
                      <span
                        className="notification-unread"
                        aria-hidden="true"
                      />
                    )}
                    {item.unread && <span className="sr-only">Unread</span>}
                  </OverlayTriggerButton>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </PopoverTrigger>
  );
}
