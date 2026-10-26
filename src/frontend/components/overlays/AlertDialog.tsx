// src/frontend/components/overlays/AlertDialog.tsx — Alert dialog primitive built on React Aria (#250).
//
// Urgent confirmations and destructive actions (e.g. Stop Run). Announced with
// role="alertdialog", labelled by its title and described by its description.
// Escape and Cancel both close without confirming.
//
// Every confirmation in the app uses this block (DESIGN.md §7, "Interaction
// patterns"). The confirm button names the action ("Delete Run"): there is no
// default label, so a confirm without a name does not compile. An `onConfirm`
// that returns a promise keeps the dialog open until the promise settles.

import "./AlertDialog.css";

import type { ReactNode } from "react";
import { Button } from "../ui/Button.js";
import { Dialog } from "./Dialog.js";

interface AlertDialogBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  cancelText?: ReactNode;
  variant?: "danger" | "warning" | "default";
  id?: string;
  className?: string;
  children?: ReactNode;
  /** Replaces the default Cancel and confirm row, for a decision with three choices. */
  actions?: ReactNode;
  /** Holds the confirm button while its action is in flight. */
  isConfirmDisabled?: boolean | undefined;
}

/** A confirm needs a name for its button; with no `onConfirm` there is no button. */
export type AlertDialogProps = AlertDialogBaseProps &
  (
    | { onConfirm?: undefined; confirmText?: ReactNode }
    | {
        onConfirm: () => unknown;
        confirmText: ReactNode;
      }
  );

function isPromise(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmText,
  cancelText = "Cancel",
  onConfirm,
  isConfirmDisabled = false,
  variant = "default",
  id,
  className,
  children,
  actions,
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
        <h2
          id={`${alertId}-title`}
          className="xf-alert-dialog-title text-headline font-semibold"
        >
          {title}
        </h2>
        {description && (
          <p id={descId} className="xf-alert-dialog-description text-subhead">
            {description}
          </p>
        )}
      </div>

      {children}

      {/* The actions are the control vocabulary's (#251): the alert adds the
          row, the block owns the surface, the press and the focus ring. */}
      {actions ? (
        <div className="xf-alert-dialog-actions">{actions}</div>
      ) : (
        <div className="xf-alert-dialog-actions">
          <Button variant="secondary" onPress={onClose}>
            {cancelText}
          </Button>
          {onConfirm && (
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              isDisabled={isConfirmDisabled}
              onPress={() => {
                const result = onConfirm();
                if (isPromise(result)) {
                  // The caller closes the dialog once the action settles.
                  void result.then(onClose);
                } else {
                  onClose();
                }
              }}
            >
              {confirmText}
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
