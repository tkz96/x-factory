// src/frontend/components/ui/SwitchControl.tsx — The switch block (#251,
// spec #241): a React Aria Switch — role="switch", Space and Enter toggle it,
// and the state is announced. The track and thumb are tokens, not images.
//
// The words come first and the track trails: a switch trails its label inside a
// row, which is the shape a Settings row wants (DESIGN.md §7). When a row
// already shows the title, `hideLabel` draws the track alone and keeps `label`
// as the accessible name.

import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface SwitchControlProps
  extends Omit<AriaSwitchProps, "className" | "children"> {
  /** The words the switch turns on, and its accessible name. */
  label: string;
  description?: string | undefined;
  /** The row already shows the title: draw the track alone. */
  hideLabel?: boolean | undefined;
  className?: string | undefined;
}

export function SwitchControl({
  label,
  description,
  hideLabel = false,
  className,
  ...props
}: SwitchControlProps) {
  const classes = ["ui-switch"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaSwitch
      {...withoutUndefined(props)}
      {...withoutUndefined({ "aria-label": hideLabel ? label : undefined })}
      className={classes.join(" ")}
    >
      <span className="ui-switch-text">
        {!hideLabel && <span className="ui-switch-label">{label}</span>}
        {description !== undefined && (
          <span className="ui-switch-description">{description}</span>
        )}
      </span>
      <span className="ui-switch-track">
        <span className="ui-switch-thumb" />
      </span>
    </AriaSwitch>
  );
}
