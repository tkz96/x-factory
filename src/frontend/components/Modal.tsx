// src/frontend/components/Modal.tsx — Reusable application modal with composition slots (#159).
//
// Owns every structural modal behaviour once: backdrop, dialog semantics labelled
// by the title, dismissal (Escape, close button, backdrop click) and background
// scroll lock. Callers supply content through slots: `title`, an optional
// `subheader` (e.g. step navigation), the scrolling body (`children`) and a fixed
// footer that body content fills with <ModalFooter>. The footer sits outside the
// scrolling body, so primary actions are never pushed off-screen.

import "./Modal.css";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../hooks/useScrollLock.js";

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
  const titleId = `${id}-title`;

  useScrollLock(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Escape is the keyboard equivalent
    <div
      className="modal-backdrop"
      id={`${id}-overlay`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className ? `modal-dialog ${className}` : "modal-dialog"}
        id={id}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            id={closeButtonId}
            className="btn-close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <svg className="icon icon-xs" aria-hidden="true">
              <use href="/assets/icons/sprite.svg#icon-x" />
            </svg>
          </button>
        </div>

        {subheader}

        <FooterSlot.Provider value={footer}>
          <div className="modal-body">{children}</div>
        </FooterSlot.Provider>

        <div className="modal-footer" ref={setFooter} />
      </div>
    </div>
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
