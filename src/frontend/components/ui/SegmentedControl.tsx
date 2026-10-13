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
import { SelectField } from "./SelectField.js";
import { useMediaQuery } from "./useMediaQuery.js";

export interface SegmentedControlOption {
  id: string;
  label: string;
  /** Sprite icon id (`/assets/icons/sprite.svg`), drawn before the label. */
  icon?: string | undefined;
  /** An explicit accessible name when the visible label is not enough. */
  accessibleLabel?: string | undefined;
  isDisabled?: boolean | undefined;
  /** A count shown after the label, read as part of the segment's name (#259). */
  count?: number | undefined;
}

export interface SegmentedControlProps {
  /** The group's accessible name — a segmented control is one control. */
  label: string;
  /** The selected option's id. */
  value: string;
  onChange: (id: string) => void;
  options: readonly SegmentedControlOption[];
  isDisabled?: boolean | undefined;
  /**
   * Below this viewport width the segments no longer fit one row, so the same
   * options render through the Select block — the platform's pop-up button for
   * too many segments. A media query string, e.g. "(max-width: 400px)".
   */
  collapseBelow?: string | undefined;
  className?: string | undefined;
}

export function SegmentedControl({
  label,
  value,
  onChange,
  options,
  isDisabled,
  collapseBelow,
  className,
}: SegmentedControlProps) {
  const collapsed = useMediaQuery(collapseBelow ?? "");

  if (collapsed) {
    // One select instead of the segments: the counts ride in the option
    // labels, so nothing the segments said is lost.
    return (
      <SelectField
        label={label}
        hideLabel
        selectedKey={value}
        onSelectionChange={(id) => onChange(String(id))}
        options={options.map((option) => ({
          id: option.id,
          label:
            option.count !== undefined
              ? `${option.label} (${option.count})`
              : option.label,
        }))}
        {...withoutUndefined({ isDisabled, className })}
      />
    );
  }

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
          {option.count !== undefined && (
            <span className="ui-segment-count">{option.count}</span>
          )}
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}
