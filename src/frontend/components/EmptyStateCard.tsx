// src/frontend/components/EmptyStateCard.tsx — Reusable empty, error, and loading state cards.

import type { CSSProperties, ReactNode } from "react";

export interface EmptyStateCardProps {
  type?: "loading" | "error" | "empty";
  icon?: string;
  title?: string;
  message?: ReactNode;
  actionText?: string;
  onAction?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function EmptyStateCard({
  type = "empty",
  icon,
  title,
  message,
  actionText,
  onAction,
  style,
  className = "",
}: EmptyStateCardProps) {
  const baseClasses = `empty-state card ${className}`.trim();

  if (type === "loading") {
    return (
      <div className={baseClasses} style={style}>
        <div className="spinner-sm" />
        {title && <h3 style={{ marginTop: "1rem" }}>{title}</h3>}
        {message && <p style={{ marginTop: "1rem" }}>{message}</p>}
      </div>
    );
  }

  if (type === "error") {
    return (
      <div className={baseClasses} style={style}>
        <div className="empty-icon">
          <svg className="icon icon-xl" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-alert-circle" />
          </svg>
        </div>
        {title && <h3>{title}</h3>}
        {message && <p className="error-message">{message}</p>}
      </div>
    );
  }

  return (
    <div className={baseClasses} style={style}>
      {icon && (
        <div className="empty-icon">
          <svg className="icon icon-xl" aria-hidden="true">
            <use href={`/assets/icons/sprite.svg#${icon}`} />
          </svg>
        </div>
      )}
      {title && <h3>{title}</h3>}
      {message && (
        <p className={typeof message === "string" ? "text-muted" : undefined}>
          {message}
        </p>
      )}
      {actionText && onAction && (
        <button
          type="button"
          className="btn-primary btn-sm"
          style={{ marginTop: "1rem" }}
          onClick={onAction}
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
