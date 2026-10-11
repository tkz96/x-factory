// src/frontend/components/overlays/AlertDialog.tsx — Alert dialog primitive built on React Aria (#250).
//
// Urgent confirmations and destructive actions (e.g. Stop Run). Announced with
// role="alertdialog", labelled by its title and described by its description.
// Escape and Cancel both close without confirming.

import "./AlertDialog.css";

import type { ReactNode } from "react";
import { Dialog } from "./Dialog.js";

export interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  onConfirm?: () => void;
  variant?: "danger" | "warning" | "default";
  id?: string;
  className?: string;
  children?: ReactNode;
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  variant = "default",
  id,
  className,
  children,
}: AlertDialogProps) {
  const alertId = id ?? "alert-dialog";
  const descId = description ? `${alertId}-desc` : undefined;
  const confirmClass =
    variant === "danger"
      ? "xf-alert-dialog-btn-danger btn-danger"
      : "xf-alert-dialog-btn-primary btn-primary";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={alertId}
      role="alertdialog"
      title={title}
      ariaDescribedBy={descId}
      className={`xf-alert-dialog-modal ${className ?? ""}`.trim()}
    >
      <div className="xf-alert-dialog-header">
        <h2 id={`${alertId}-title`} className="xf-alert-dialog-title">
          {title}
        </h2>
        {description && (
          <p id={descId} className="xf-alert-dialog-description">
            {description}
          </p>
        )}
      </div>

      {children}

      <div className="xf-alert-dialog-actions">
        <button
          type="button"
          className="xf-alert-dialog-btn xf-alert-dialog-btn-cancel btn-secondary"
          onClick={onClose}
        >
          {cancelText}
        </button>
        {onConfirm && (
          <button
            type="button"
            className={`xf-alert-dialog-btn ${confirmClass}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        )}
      </div>
    </Dialog>
  );
}
