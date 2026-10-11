// src/frontend/components/overlays/Dialog.tsx — Modal dialog primitive built on React Aria (#250).
//
// Focus containment and focus restore come from React Aria's modal. This module
// adds what React Aria leaves to the app: a stack-aware Escape, inert background,
// scroll lock, and a backdrop click that dismisses (one close path, so a click
// never closes twice).

import "./Dialog.css";

import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useRef,
} from "react";
import {
  Dialog as RACDialog,
  Heading as RACHeading,
  Modal as RACModal,
  ModalOverlay as RACModalOverlay,
} from "react-aria-components";
import { useScrollLock } from "../../hooks/useScrollLock.js";
import {
  useFocusTrap,
  useInertBackground,
  useOverlayDismiss,
  useRestoreFocus,
} from "./overlay-stack.js";

interface DialogContextValue {
  titleId?: string | undefined;
  onClose?: (() => void) | undefined;
}

const DialogContext = createContext<DialogContextValue>({});

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  id?: string | undefined;
  title?: ReactNode;
  ariaLabel?: string | undefined;
  ariaLabelledBy?: string | undefined;
  ariaDescribedBy?: string | undefined;
  role?: "dialog" | "alertdialog";
  className?: string | undefined;
  overlayClassName?: string | undefined;
  overlayId?: string | undefined;
  children: ReactNode;
}

export function Dialog({
  isOpen,
  onClose,
  id,
  title,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  role = "dialog",
  className,
  overlayClassName,
  overlayId,
  children,
}: DialogProps) {
  const autoId = useId();
  const dialogId = id ?? `dialog-${autoId}`;
  const titleId = ariaLabelledBy ?? (title ? `${dialogId}-title` : undefined);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const resolvedOverlayId = overlayId ?? `${dialogId}-overlay`;
  // React Aria's ModalOverlay takes no id prop, so the id lands on the element here.
  const setOverlay = (el: HTMLDivElement | null) => {
    overlayRef.current = el;
    if (el) el.id = resolvedOverlayId;
  };
  // React Aria's Dialog does not render aria-modal, so the dialog marks itself.
  const markModal = (el: HTMLElement | null) =>
    el?.setAttribute("aria-modal", "true");
  // Exactly one accessible name: the title when there is one, otherwise the label.
  const labelProps = titleId
    ? { "aria-labelledby": titleId }
    : ariaLabel
      ? { "aria-label": ariaLabel }
      : {};
  useScrollLock(isOpen);
  useOverlayDismiss(isOpen, onClose);
  useInertBackground(overlayRef, isOpen);
  useRestoreFocus(isOpen);
  useFocusTrap(overlayRef, isOpen);

  if (!isOpen) return null;

  // Server render has no document to portal into, so the markup is written in
  // place, as the old DialogPortal did. Focus and dismissal are client effects.
  if (typeof document === "undefined") {
    return (
      <div
        id={resolvedOverlayId}
        className={`xf-dialog-overlay ${overlayClassName ?? ""}`.trim()}
      >
        <div
          id={dialogId}
          role={role}
          {...labelProps}
          className={`xf-dialog-content ${className ?? ""}`.trim()}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <DialogContext.Provider value={{ titleId, onClose }}>
      <RACModalOverlay
        isOpen={isOpen}
        isDismissable={false}
        ref={setOverlay}
        className={`xf-dialog-overlay ${overlayClassName ?? ""}`.trim()}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <RACModal className="xf-dialog-modal">
          <RACDialog
            id={dialogId}
            role={role}
            ref={markModal}
            {...labelProps}
            {...(ariaDescribedBy
              ? { "aria-describedby": ariaDescribedBy }
              : {})}
            className={`xf-dialog-content ${className ?? ""}`.trim()}
          >
            {children}
          </RACDialog>
        </RACModal>
      </RACModalOverlay>
    </DialogContext.Provider>
  );
}

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`xf-dialog-header modal-header ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}

export function DialogTitle({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const context = useContext(DialogContext);
  return (
    <RACHeading
      slot="title"
      id={id ?? context.titleId}
      className={`xf-dialog-title ${className ?? ""}`.trim()}
    >
      {children}
    </RACHeading>
  );
}

export function DialogBody({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`xf-dialog-body modal-body ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}

export function DialogFooter({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`xf-dialog-footer modal-footer ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}

export function DialogCloseButton({
  id,
  onClose,
  ariaLabel = "Close dialog",
  className,
}: {
  id?: string;
  onClose?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const context = useContext(DialogContext);
  return (
    <button
      type="button"
      id={id}
      className={`xf-dialog-close-btn btn-close ${className ?? ""}`.trim()}
      aria-label={ariaLabel}
      onClick={onClose ?? context.onClose}
    >
      <svg className="icon icon-xs" aria-hidden="true">
        <use href="/assets/icons/sprite.svg#icon-x" />
      </svg>
    </button>
  );
}
