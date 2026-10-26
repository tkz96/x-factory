// The specimen's switches: theme, appearance, contrast, Reduce Transparency and
// the Readable font. They set the root attributes through SpecimenView only.

import { SegmentedControl } from "../ui/SegmentedControl.js";
import { SwitchControl } from "../ui/SwitchControl.js";
import type { SpecimenSettings } from "./specimen-settings.js";

export interface SpecimenControlsProps {
  settings: SpecimenSettings;
  onChange: (next: SpecimenSettings) => void;
}

export function SpecimenControls({
  settings,
  onChange,
}: SpecimenControlsProps) {
  const set = (patch: Partial<SpecimenSettings>) =>
    onChange({ ...settings, ...patch });
  return (
    <section className="specimen-section" aria-labelledby="specimen-controls">
      <h2 id="specimen-controls" className="specimen-heading text-title-3">
        Switches
      </h2>
      <div className="specimen-switches">
        <SegmentedControl
          label="Theme"
          value={settings.theme}
          onChange={(id) => set({ theme: id as SpecimenSettings["theme"] })}
          options={[
            { id: "default", label: "Default" },
            { id: "graphite", label: "Graphite" },
            { id: "sandstone", label: "Sandstone" },
          ]}
        />
        <SegmentedControl
          label="Appearance"
          value={settings.appearance}
          onChange={(id) =>
            set({ appearance: id as SpecimenSettings["appearance"] })
          }
          options={[
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
        />
        <SegmentedControl
          label="Contrast"
          value={settings.contrast}
          onChange={(id) =>
            set({ contrast: id as SpecimenSettings["contrast"] })
          }
          options={[
            { id: "standard", label: "Standard" },
            { id: "more", label: "Increase" },
          ]}
        />
        <SegmentedControl
          label="Reduce Transparency"
          value={settings.transparency}
          onChange={(id) =>
            set({ transparency: id as SpecimenSettings["transparency"] })
          }
          options={[
            { id: "automatic", label: "Automatic" },
            { id: "reduced", label: "On" },
            { id: "full", label: "Off" },
          ]}
        />
        <SwitchControl
          label="Readable font"
          description="Atkinson Hyperlegible for all text"
          isSelected={settings.readableFont}
          onChange={(readableFont) => set({ readableFont })}
        />
      </div>
    </section>
  );
}
