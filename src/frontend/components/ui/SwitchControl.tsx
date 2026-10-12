// src/frontend/components/ui/SwitchControl.tsx — The switch block (#251,
// spec #241): a React Aria Switch — role="switch", Space and Enter toggle it,
// and the state is announced. The track and thumb are tokens, not images.

import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface SwitchControlProps
  extends Omit<AriaSwitchProps, "className" | "children"> {
  label: string;
  description?: string | undefined;
  className?: string | undefined;
}

export function SwitchControl({
  label,
  description,
  className,
  ...props
}: SwitchControlProps) {
  const classes = ["ui-switch"];
  if (className !== undefined) classes.push(className);
  return (
    <div className="ui-switch-group">
      <AriaSwitch {...withoutUndefined(props)} className={classes.join(" ")}>
        <span className="ui-switch-track">
          <span className="ui-switch-thumb" />
        </span>
        <span className="ui-switch-label">{label}</span>
      </AriaSwitch>
      {description !== undefined && (
        <span className="ui-switch-description">{description}</span>
      )}
    </div>
  );
}
