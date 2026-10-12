// src/frontend/components/overlays/AlertDialog.tsx — Alert dialog primitive built on React Aria (#250).
//
// Urgent confirmations and destructive actions (e.g. Stop Run). Announced with
// role="alertdialog", labelled by its title and described by its description.
// Escape and Cancel both close without confirming.

import "./AlertDialog.css";

import type { ReactNode } from "react";
import { Button } from "../ui/Button.js";
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

      {/* The actions are the control vocabulary's (#251): the alert adds the
          row, the block owns the surface, the press and the focus ring. */}
      <div className="xf-alert-dialog-actions">
        <Button variant="secondary" onPress={onClose}>
          {cancelText}
        </Button>
        {onConfirm && (
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onPress={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
