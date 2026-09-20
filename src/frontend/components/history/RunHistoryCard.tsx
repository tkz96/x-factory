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
      style={{
        display: "flex",
        justifyContent: "space-between",
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        marginBottom: "0.75rem",
      }}
    >
      <div className="history-meta">
        <span className="history-ticket" style={{ fontWeight: 600 }}>
          #{ticketId} — {ticketTitle}
        </span>
        <span
          className="history-sub text-muted"
          style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}
        >
          {projectName ? `${projectName} · ` : ""}
          <code style={{ fontSize: "0.8rem" }}>{run.branch}</code>
          {` · ${dateStr}`}
        </span>
      </div>

      <span
        className="badge"
        data-status={run.status}
        style={{ textTransform: "capitalize", alignSelf: "center" }}
      >
        {statusLabel}
      </span>
    </Link>
  );
}
