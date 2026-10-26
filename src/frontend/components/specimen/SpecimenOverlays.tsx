// The specimen's overlays: each opens the real block, in place.

import { useState } from "react";
import {
  AlertDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Sheet,
  Tooltip,
  TooltipTrigger,
} from "../overlays/index.js";
import { Button } from "../ui/Button.js";

export function SpecimenOverlays() {
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);
  const [sheet, setSheet] = useState<"right" | "bottom" | null>(null);
  return (
    <section className="specimen-section" aria-labelledby="specimen-overlays">
      <h2 id="specimen-overlays" className="specimen-heading">
        Overlays
      </h2>
      <div className="specimen-row">
        <Button variant="secondary" onPress={() => setDialog(true)}>
          Open dialog…
        </Button>
        <Button variant="danger" onPress={() => setAlert(true)}>
          Delete Run…
        </Button>
        <Button variant="secondary" onPress={() => setSheet("right")}>
          Open sheet…
        </Button>
        <Button variant="secondary" onPress={() => setSheet("bottom")}>
          Open bottom sheet…
        </Button>
        <MenuTrigger>
          <Button variant="quiet" aria-label="Run actions">
            <span aria-hidden="true">…</span>
          </Button>
          <Popover placement="bottom start">
            <Menu>
              <MenuItem id="spec-open">Open Run</MenuItem>
              <MenuItem id="spec-stop" isDanger>
                Stop Run
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
        <TooltipTrigger delay={0}>
          <Button variant="secondary">Hover for tooltip</Button>
          <Tooltip placement="bottom">Tooltip text</Tooltip>
        </TooltipTrigger>
      </div>

      <Dialog
        isOpen={dialog}
        onClose={() => setDialog(false)}
        title="Edit Repository"
      >
        <DialogBody>
          <p>A dialog holds a form or a summary, and one primary action.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onPress={() => setDialog(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => setDialog(false)}>
            Save
          </Button>
        </DialogFooter>
      </Dialog>

      <AlertDialog
        isOpen={alert}
        onClose={() => setAlert(false)}
        title="Delete this run?"
        description="The run and its log are removed. This cannot be undone."
        confirmText="Delete Run"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => setAlert(false)}
      />

      <Sheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        position={sheet ?? "right"}
        title="Run details"
      >
        <DialogBody>
          <p>A sheet travels from the edge it is docked to.</p>
        </DialogBody>
      </Sheet>
    </section>
  );
}
