// src/frontend/components/notifications/NotificationActivity.tsx — The quiet toolbar
// activity area: what is in progress right now (#264, spec #241). It is a link to the
// run, or to Runs when several are going. Nothing here is stored or announced.

import { Icon } from "../ui/Icon.js";
import "./NotificationActivity.css";

import { Link } from "react-router-dom";
import { useNotificationCenter } from "../../context/NotificationContext.js";
import { runStatusText } from "../../lib/run-status-ui.js";

export function NotificationActivity() {
  const { activeRuns } = useNotificationCenter();
  if (activeRuns.length === 0) return null;

  const [only] = activeRuns;
  if (activeRuns.length === 1 && only) {
    const status = runStatusText(only.status);
    return (
      <Link
        to={`/runs/${encodeURIComponent(only.runId)}`}
        className="toolbar-activity text-footnote"
        aria-label={`${only.ticketId}: ${status}`}
      >
        <Icon name="icon-loader-2" size="sm" className="icon-spin" />
        <span className="toolbar-activity-text">
          {only.ticketId} · {status}
        </span>
      </Link>
    );
  }

  const count = activeRuns.length;
  return (
    <Link
      to="/runs"
      className="toolbar-activity text-footnote"
      aria-label={`${count} runs in progress`}
    >
      <Icon name="icon-loader-2" size="sm" className="icon-spin" />
      <span className="toolbar-activity-text">{count} runs in progress</span>
    </Link>
  );
}
