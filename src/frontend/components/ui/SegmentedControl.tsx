// src/frontend/components/ui/SegmentedControl.tsx — The segmented control block
// (#251, spec #241).
//
// One control, mutually exclusive options: React Aria's RadioGroup, which is
// what a single-select segmented control is — a radiogroup with one tab stop
// (the selected segment), arrow keys between segments, and the choice announced
// as checked. React Aria's `Radio` renders the visible segment as the label of
// a native radio input, so the tokens style the label and the platform keeps
// the radio semantics.

import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface SegmentedControlOption {
  id: string;
  label: string;
  /** Sprite icon id (`/assets/icons/sprite.svg`), drawn before the label. */
  icon?: string | undefined;
  /** An explicit accessible name when the visible label is not enough. */
  accessibleLabel?: string | undefined;
  isDisabled?: boolean | undefined;
}

export interface SegmentedControlProps {
  /** The group's accessible name — a segmented control is one control. */
  label: string;
  /** The selected option's id. */
  value: string;
  onChange: (id: string) => void;
  options: readonly SegmentedControlOption[];
  isDisabled?: boolean | undefined;
  className?: string | undefined;
}

export function SegmentedControl({
  label,
  value,
  onChange,
  options,
  isDisabled,
  className,
}: SegmentedControlProps) {
  const classes = ["ui-segmented"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaRadioGroup
      aria-label={label}
      className={classes.join(" ")}
      orientation="horizontal"
      value={value}
      {...withoutUndefined({ isDisabled, onChange })}
    >
      {options.map((option) => (
        <AriaRadio
          key={option.id}
          value={option.id}
          className="ui-segment"
          {...withoutUndefined({
            "aria-label": option.accessibleLabel,
            isDisabled: option.isDisabled,
          })}
          data-segment-value={option.id}
        >
          {option.icon !== undefined && (
            <svg className="icon icon-sm" aria-hidden="true">
              <use href={`/assets/icons/sprite.svg#${option.icon}`} />
            </svg>
          )}
          <span>{option.label}</span>
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}
