// The specimen's type scale and corner comparison. Each sample uses the same
// tokens the blocks use, so a change to the ladder shows here first.

import { Button } from "../ui/Button.js";
import { TextField } from "../ui/TextField.js";

const TYPE_SCALE = [
  ["Large Title", "large-title"],
  ["Title 1", "title-1"],
  ["Title 2", "title-2"],
  ["Title 3", "title-3"],
  ["Headline", "headline"],
  ["Body", "body"],
  ["Callout", "callout"],
  ["Subheadline", "subhead"],
  ["Footnote", "footnote"],
  ["Caption 1", "caption-1"],
  ["Caption 2", "caption-2"],
] as const;

export function SpecimenTypeScale() {
  return (
    <section className="specimen-section" aria-labelledby="specimen-type">
      <h2 id="specimen-type" className="specimen-heading">
        Type scale
      </h2>
      {TYPE_SCALE.map(([name, key]) => (
        <p key={key} className={`specimen-type text-${key}`}>
          <span className="specimen-type-name">{name}</span> The quick brown fox
        </p>
      ))}
    </section>
  );
}

/** The four surfaces compared against macOS: button, card, sheet and field. */
export function SpecimenCorners() {
  return (
    <section className="specimen-section" aria-labelledby="specimen-corners">
      <h2 id="specimen-corners" className="specimen-heading">
        Corners
      </h2>
      <div className="specimen-corners">
        <div className="specimen-corner-cell" data-corner="button">
          <Button variant="primary">Button</Button>
        </div>
        <div className="specimen-corner-cell" data-corner="card">
          <div className="specimen-corner-card">Card · --radius-card</div>
        </div>
        <div className="specimen-corner-cell" data-corner="sheet">
          <div className="specimen-corner-sheet">Sheet · --radius-lg</div>
        </div>
        <div className="specimen-corner-cell" data-corner="field">
          <TextField label="Field" placeholder="Text field" />
        </div>
      </div>
    </section>
  );
}
