// src/frontend/components/runs/DiffModal.tsx — Full-screen modal for per-file syntax-highlighted diffs.

import "./DiffModal.css";

import { useMemo } from "react";
import { Dialog } from "../overlays/Dialog.js";
import { Button } from "../ui/Button.js";

export interface DiffModalProps {
  isOpen: boolean;
  file: string | null;
  added: number;
  removed: number;
  hunks: string;
  onClose: () => void;
}

export function DiffModal({
  isOpen,
  file,
  added,
  removed,
  hunks,
  onClose,
}: DiffModalProps) {
  const diffRows = useMemo(() => {
    if (!isOpen || !file) return [];
    return hunks.split("\n").map((line, index) => ({
      id: `${file}-${index}-${line.slice(0, 12)}`,
      line,
    }));
  }, [isOpen, hunks, file]);

  return (
    <Dialog
      isOpen={isOpen && file !== null}
      onClose={onClose}
      id="diff-modal"
      overlayId="diff-modal-backdrop"
      overlayClassName="modal-backdrop"
      ariaLabel={file ? `Diff for ${file}` : undefined}
      className="modal-dialog diff-modal-dialog"
    >
      {file !== null && (
        <>
          <header className="diff-modal-header">
            <div className="diff-modal-title-wrap">
              <span className="diff-modal-filename" id="diff-modal-filename">
                {file}
              </span>
              <div className="diff-modal-stats">
                <span className="diff-modal-badge diff-modal-add">{`+${added}`}</span>
                <span className="diff-modal-badge diff-modal-remove">{`−${removed}`}</span>
              </div>
            </div>
            <button
              type="button"
              className="diff-modal-close-btn"
              id="diff-modal-close"
              onClick={onClose}
              aria-label="Close diff modal"
            >
              <svg
                className="icon icon-sm"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="diff-modal-body">
            <pre className="diff-modal-content">
              {diffRows.map((row) => {
                let lineClass = "diff-row diff-row-context";
                let prefix = " ";
                if (row.line.startsWith("+") && !row.line.startsWith("+++")) {
                  lineClass = "diff-row diff-row-add";
                  prefix = "+";
                } else if (
                  row.line.startsWith("-") &&
                  !row.line.startsWith("---")
                ) {
                  lineClass = "diff-row diff-row-del";
                  prefix = "-";
                } else if (row.line.startsWith("@@")) {
                  lineClass = "diff-row diff-row-hunk";
                  prefix = "@";
                }

                return (
                  <div key={row.id} className={lineClass}>
                    <span className="diff-row-prefix">{prefix}</span>
                    <span className="diff-row-text">{row.line}</span>
                  </div>
                );
              })}
            </pre>
          </div>

          <div className="modal-actions">
            <Button variant="secondary" size="sm" onPress={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
