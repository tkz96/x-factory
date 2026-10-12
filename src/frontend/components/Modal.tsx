import "./Modal.css";

import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogCloseButton, DialogTitle } from "./overlays/Dialog.js";

// undefined: not inside a <Modal>. null: inside one whose footer has not mounted yet.
const FooterSlot = createContext<HTMLElement | null | undefined>(undefined);

interface ModalProps {
  /** Id of the dialog element; the backdrop, title and close button derive theirs from it. */
  id: string;
  title: ReactNode;
  onClose: () => void;
  /** Extra class on the dialog, for size modifiers. */
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
  onClose,
  className,
  subheader,
  closeButtonId = `${id}-close`,
  children,
}: ModalProps) {
  const [footer, setFooter] = useState<HTMLElement | null>(null);

  // The shared dialog primitive owns focus, inertness, Escape and scroll lock.
  return (
    <Dialog
      isOpen
      onClose={onClose}
      id={id}
      title={title}
      overlayClassName="modal-backdrop"
      className={className ? `modal-dialog ${className}` : "modal-dialog"}
    >
      <div className="modal-header">
        <DialogTitle>{title}</DialogTitle>
        <DialogCloseButton id={closeButtonId} onClose={onClose} />
      </div>

      {subheader}

      <FooterSlot.Provider value={footer}>
        <div className="modal-body">{children}</div>
      </FooterSlot.Provider>

      <div className="modal-footer" ref={setFooter} />
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
  const actions = <div className="modal-actions">{children}</div>;
  if (footer === undefined) return actions;
  return footer ? createPortal(actions, footer) : null;
}
