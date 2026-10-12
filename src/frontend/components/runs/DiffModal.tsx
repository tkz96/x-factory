// src/frontend/components/runs/DiffModal.tsx — Full-screen modal for per-file
// syntax-highlighted diffs (SYS-13/SYS-14: the shared window).

import "./DiffModal.css";

import { useMemo } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
} from "../overlays/Dialog.js";
import { Badge } from "../ui/Badge.js";
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
      ariaLabel={file ? `Diff for ${file}` : undefined}
      className="xf-dialog-window diff-modal-dialog"
    >
      {file !== null && (
        <>
          <DialogHeader>
            <div className="diff-modal-title-wrap">
              <span className="diff-modal-filename" id="diff-modal-filename">
                {file}
              </span>
              <div className="diff-modal-stats">
                <Badge tone="success">{`+${added}`}</Badge>
                <Badge tone="error">{`−${removed}`}</Badge>
              </div>
            </div>
            <DialogCloseButton
              id="diff-modal-close"
              ariaLabel="Close diff modal"
              onClose={onClose}
            />
          </DialogHeader>

          <DialogBody className="diff-modal-body">
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
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onPress={onClose}>
              Close
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
