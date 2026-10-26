// src/frontend/components/settings/AccessibilitySettings.tsx — Settings → Accessibility (spec #292).
//
// The Readable font and Reduce Transparency choices belong to the app, not to
// the system: Safari does not tell a page about the system Reduce Transparency
// setting, so Automatic gives glass there and the help text says so.

import {
  setReadableFont,
  setTransparency,
  type TransparencySetting,
  useTheme,
} from "../../hooks/useTheme.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";
import { SwitchControl } from "../ui/SwitchControl.js";

const TRANSPARENCY_CHOICES: readonly {
  id: TransparencySetting;
  label: string;
}[] = [
  { id: "automatic", label: "Automatic" },
  { id: "reduced", label: "On" },
  { id: "full", label: "Off" },
];

export function AccessibilitySettings() {
  const { transparency, readableFont } = useTheme();

  return (
    <>
      <ListGroup
        title="Text"
        footer="Atkinson Hyperlegible is designed to make letters easier to tell apart. It applies to every screen, in every theme."
      >
        <ListGroupRow
          title="Readable font"
          trailing={
            <SwitchControl
              label="Readable font"
              hideLabel
              isSelected={readableFont}
              onChange={setReadableFont}
            />
          }
        />
      </ListGroup>

      <ListGroup
        title="Transparency"
        footer="Automatic follows the system Reduce Transparency setting where the browser reports it. Safari does not report it, so choose On if that setting is on."
      >
        <ListGroupRow
          title="Reduce transparency"
          trailing={
            <SegmentedControl
              label="Reduce transparency"
              value={transparency}
              onChange={(id) => {
                const choice = TRANSPARENCY_CHOICES.find(
                  (item) => item.id === id,
                );
                if (choice !== undefined) setTransparency(choice.id);
              }}
              options={TRANSPARENCY_CHOICES.map((choice) => ({
                id: choice.id,
                label: choice.label,
                accessibleLabel: `Reduce transparency: ${choice.label}`,
              }))}
            />
          }
        />
      </ListGroup>
    </>
  );
}
