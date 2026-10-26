// src/frontend/components/ui/SegmentedControl.tsx — The segmented control block
// (#251, spec #241).
//
// One control, mutually exclusive options: React Aria's RadioGroup, which is
// what a single-select segmented control is — a radiogroup with one tab stop
// (the selected segment), arrow keys between segments, and the choice announced
// as checked. React Aria's `Radio` renders the visible segment as the label of
// a native radio input, so the tokens style the label and the platform keeps
// the radio semantics.

import { type MotionStyle, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";
import { Icon } from "./Icon.js";
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
  /** Draws only the icon. The label stays the segment's accessible name and its tooltip. */
  iconOnly?: boolean | undefined;
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
  // One thumb for the whole control, positioned under the selected segment and
  // moved by a layout animation, so a change slides it from the old segment to
  // the new one. Only a pointer press slides it: a keyboard shortcut, an arrow
  // key, a route change or a resize moves it at once, because those happen far
  // too often to wait on motion. The transition is chosen when the change is
  // measured, on the one element that animates.
  const groupRef = useRef<HTMLDivElement>(null);
  const pointerChange = useRef(false);
  const animateThumb = useRef(false);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  // A press is caught on the way down (capture): React Aria's press handling
  // stops the event before it would bubble to the group.
  useEffect(() => {
    // A collapsed control is a select: there is no group to listen on.
    if (collapsed) return;
    const group = groupRef.current;
    if (group === null) return;
    const onPointerDown = () => {
      pointerChange.current = true;
    };
    group.addEventListener("pointerdown", onPointerDown, true);
    return () => group.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapsed]);
  useLayoutEffect(() => {
    if (collapsed) return;
    const group = groupRef.current;
    if (group === null) return;
    const measure = () => {
      const segment = group.querySelector<HTMLElement>(
        `[data-segment-value="${CSS.escape(value)}"]`,
      );
      const next =
        segment === null
          ? null
          : { x: segment.offsetLeft, w: segment.offsetWidth };
      // An unchanged place re-renders nothing, so it never cuts a slide short.
      setThumb((prev) =>
        prev !== null && next !== null && prev.x === next.x && prev.w === next.w
          ? prev
          : next,
      );
    };
    animateThumb.current = pointerChange.current;
    pointerChange.current = false;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // A resize (fonts settling, a wider window) moves the thumb at once. The
    // observer's first report is the size it started with, so it is skipped.
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      animateThumb.current = false;
      measure();
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, [value, collapsed]);
  // The thumb's place is passed as custom properties; the stylesheet owns the
  // geometry (the inset, the radius).
  const thumbPlace =
    thumb === null
      ? undefined
      : ({
          "--thumb-x": `${thumb.x}px`,
          "--thumb-w": `${thumb.w}px`,
        } as MotionStyle);

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
      ref={groupRef}
      aria-label={label}
      className={classes.join(" ")}
      orientation="horizontal"
      value={value}
      {...withoutUndefined({ isDisabled, onChange })}
    >
      {thumbPlace !== undefined && (
        <m.span
          className="ui-segment-thumb"
          aria-hidden="true"
          layout
          style={thumbPlace}
          {...(animateThumb.current ? {} : { transition: { type: false } })}
        />
      )}
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
          {option.iconOnly && option.icon !== undefined ? (
            <span className="ui-segment-icon" title={option.label}>
              <Icon name={option.icon} size="sm" />
              <span className="sr-only">{option.label}</span>
            </span>
          ) : (
            <>
              {option.icon !== undefined && (
                <Icon name={option.icon} size="sm" />
              )}
              <span>{option.label}</span>
            </>
          )}
          {option.count !== undefined && (
            <span className="ui-segment-count">{option.count}</span>
          )}
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}
