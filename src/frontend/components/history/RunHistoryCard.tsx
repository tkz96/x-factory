import "./RunHistoryCard.css";

import { Link } from "react-router-dom";
import type { Run } from "../../../shared/types.js";

interface RunHistoryCardProps {
  run: Run;
}

export function RunHistoryCard({ run }: RunHistoryCardProps) {
  const ticketId = run.ticket?.id || run.id;
  const ticketTitle = run.ticket?.title || "Run";
  const projectName = run.project?.name || run.project?.id || "";
  const dateStr = run.startedAt
    ? new Date(run.startedAt).toLocaleString()
    : "Recently";
  const statusLabel = run.status.replace(/_/g, " ");

  return (
    <Link
      to={`/runs/${run.id}`}
      className="history-item card"
      aria-label={`View run for ticket ${ticketId}: ${ticketTitle}`}
    >
      <div className="history-meta">
        <span className="history-ticket">
          #{ticketId} — {ticketTitle}
        </span>
        <span className="history-sub text-muted">
          {projectName ? `${projectName} · ` : ""}
          <code className="history-branch">{run.branch}</code>
          {` · ${dateStr}`}
        </span>
      </div>

      <span className="badge history-badge" data-status={run.status}>
        {statusLabel}
      </span>
    </Link>
  );
}
