// src/frontend/components/palette/ShortcutSheet.tsx — The ? sheet listing every shortcut (#254).
//
// Reads the same registry as the global handler and the palette, so the sheet
// cannot show a binding that does not work.

import "./ShortcutSheet.css";

import {
  formatShortcut,
  isMacPlatform,
  SHORTCUTS,
  type ShortcutGroup,
} from "../../shortcuts/registry.js";
import {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from "../overlays/Dialog.js";
import { Sheet } from "../overlays/Sheet.js";

const GROUP_ORDER: ShortcutGroup[] = ["Navigation", "Actions", "Help"];

export interface ShortcutSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutSheet({ isOpen, onClose }: ShortcutSheetProps) {
  const isMac = isMacPlatform();
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      position="right"
      ariaLabel="Keyboard shortcuts"
      className="shortcut-sheet"
    >
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogCloseButton onClose={onClose} />
      </DialogHeader>
      <DialogBody className="shortcut-sheet-body">
        {GROUP_ORDER.map((group) => (
          <section key={group} className="shortcut-group">
            <h3 className="shortcut-group-title text-footnote font-semibold">
              {group}
            </h3>
            <dl className="shortcut-list">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => {
                const keys = formatShortcut(s, isMac);
                return (
                  <div key={s.id} className="shortcut-row">
                    <dt>{s.label}</dt>
                    <dd>
                      {keys ? (
                        <kbd className="shortcut-keys text-caption-1">
                          {keys}
                        </kbd>
                      ) : null}
                      <span className="shortcut-alternative text-caption-1">
                        {keys ? "Also: " : ""}
                        {s.alternative}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </DialogBody>
    </Sheet>
  );
}
