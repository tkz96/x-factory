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
  useCallback,
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
import { IconButton } from "../ui/IconButton.js";
import {
  useFocusTrap,
  useInertBackground,
  useOverlayDismiss,
  useOverlayPresence,
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
  //
  // Both refs this component hands to React Aria are STABLE. React Aria wraps a
  // callback ref in `useObjectRef`, which rebuilds its ref object whenever the
  // callback's identity changes — and `useDialog`'s "focus the dialog on mount"
  // effect depends on that ref. A fresh callback ref on every render therefore
  // re-runs the effect on every render, and it steals focus from whatever the
  // user is typing in mid-keystroke. A stable ref keeps the effect to the mount.
  const setOverlay = useCallback(
    (el: HTMLDivElement | null) => {
      overlayRef.current = el;
      if (el) el.id = resolvedOverlayId;
    },
    [resolvedOverlayId],
  );
  // React Aria's Dialog does not render aria-modal, so the dialog marks itself.
  const markModal = useCallback((el: HTMLElement | null) => {
    el?.setAttribute("aria-modal", "true");
  }, []);
  // Exactly one accessible name: the title when there is one, otherwise the label.
  const labelProps = titleId
    ? { "aria-labelledby": titleId }
    : ariaLabel
      ? { "aria-label": ariaLabel }
      : {};
  useScrollLock(isOpen);
  useOverlayDismiss(isOpen, onClose);
  useInertBackground(overlayRef, isOpen);
  useFocusTrap(overlayRef, isOpen);
  // Closing animates: React Aria keeps the overlay mounted, marked `data-exiting`, and
  // Dialog.css and Sheet.css play the exit from that state. Returning null on
  // `isOpen === false` would unmount straight away and skip the animation.
  const isPresent = useOverlayPresence(overlayRef, isOpen);
  // Focus returns to the trigger once the overlay is gone, not while it is still on
  // screen: React Aria moves focus back into the dialog as it exits, so a restore at
  // close time would be undone a moment later.
  useRestoreFocus(isPresent);

  // Server render has no document to portal into, so the markup is written in
  // place, as the old DialogPortal did. Focus and dismissal are client effects.
  if (typeof document === "undefined") {
    if (!isOpen) return null;
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

  if (!isPresent) return null;

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
  // The close control is the icon-button block (#251): it carries the
  // accessible name, and `--tap-min` size it had lost.
  return (
    <IconButton
      id={id}
      label={ariaLabel}
      icon="icon-x"
      className={className}
      onPress={onClose ?? context.onClose}
    />
  );
}
