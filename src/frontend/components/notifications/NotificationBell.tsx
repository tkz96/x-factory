// src/frontend/components/notifications/NotificationBell.tsx — The toolbar bell and its
// notification list (#264, spec #241). A popover, not a toast: it opens from the bell,
// closes on Escape or on choosing an item, and returns focus to the bell.

import "./NotificationBell.css";

import { useState } from "react";
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
import { Button } from "../ui/Button.js";
import { DesktopNotificationPrompt } from "./DesktopNotificationPrompt.js";

export function NotificationBell() {
  const { notifications, unreadCount, needsYouCount, markRead, markAllRead } =
    useNotificationCenter();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  const choose = (item: NotificationListItem) => {
    markRead(item.id);
    setOpen(false);
    navigate(`/runs/${encodeURIComponent(item.runId)}`);
  };

  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="secondary"
        size="sm"
        className="notification-bell"
        aria-label={label}
      >
        <svg className="icon icon-md" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-bell" />
        </svg>
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount}
          </span>
        )}
      </Button>
      <Popover placement="bottom end" className="notification-popover">
        <PopoverContent aria-label="Notifications">
          <DesktopNotificationPrompt hasNeedsYou={needsYouCount > 0} />
          <div className="notification-popover-head">
            <h2 className="notification-popover-title">Notifications</h2>
            <Button
              variant="secondary"
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
