// src/frontend/components/Modal.tsx — The reusable application modal (#159, SYS-13).
//
// A dialog composes <Modal> instead of re-implementing a window: the surface,
// the backdrop, the header, the scrolling body and the pinned footer are the
// one Sheet/Dialog structure (#250), and this module adds only what is the
// reusable modal's own — an optional subheader and the footer slot.
//
// It stays mounted and is told whether it is open (`isOpen`), so closing plays
// the shared exit instead of vanishing with the mount (#250).

import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from "./overlays/Dialog.js";

// undefined: not inside a <Modal>. null: inside one whose footer has not mounted yet.
const FooterSlot = createContext<HTMLElement | null | undefined>(undefined);

interface ModalProps {
  /** Id of the dialog element; the overlay, title and close button derive theirs from it. */
  id: string;
  title: ReactNode;
  /** Whether the dialog is showing. It stays mounted while it is false. */
  isOpen?: boolean;
  onClose: () => void;
  /** Extra class on the window, for the rare screen-specific width. */
  className?: string;
  /** Rendered between the header and the scrolling body, and never scrolls. */
  subheader?: ReactNode;
  /** Overrides the derived close-button id (`<id>-close`). */
  closeButtonId?: string;
  children: ReactNode;
}

export function Modal({
  id,
  title,
  isOpen = true,
  onClose,
  className,
  subheader,
  closeButtonId = `${id}-close`,
  children,
}: ModalProps) {
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const classes = ["xf-dialog-window"];
  if (className !== undefined) classes.push(className);

  // The shared dialog primitive owns focus, inertness, Escape and scroll lock.
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={id}
      title={title}
      className={classes.join(" ")}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogCloseButton id={closeButtonId} onClose={onClose} />
      </DialogHeader>

      {subheader}

      <FooterSlot.Provider value={footer}>
        <DialogBody>{children}</DialogBody>
      </FooterSlot.Provider>

      <div className="xf-dialog-footer" ref={setFooter} />
    </Dialog>
  );
}

/**
 * Actions for the surrounding <Modal>'s fixed footer. Rendered from inside the
 * body so the actions keep access to the body's local state. Outside a modal
 * (for example a step rendered on its own in a test) it renders in place.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  const footer = useContext(FooterSlot);
  const actions = <div className="xf-dialog-actions">{children}</div>;
  if (footer === undefined) return actions;
  return footer ? createPortal(actions, footer) : null;
}
