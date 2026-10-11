// src/frontend/components/ui/IconButton.tsx — The icon-only button block (#251).
//
// An icon-only control must have an accessible name (DESIGN.md §8), so `label`
// is required rather than optional.

import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export interface IconButtonProps
  extends Omit<AriaButtonProps, "className" | "children"> {
  /** The accessible name — never optional on an icon-only control. */
  label: string;
  /** Sprite icon id (`/assets/icons/sprite.svg`). */
  icon: string;
  className?: string;
}

export function IconButton({
  label,
  icon,
  className,
  ...props
}: IconButtonProps) {
  const classes = ["ui-icon-button"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaButton
      {...withoutUndefined(props)}
      aria-label={label}
      className={classes.join(" ")}
    >
      <svg className="icon icon-md" aria-hidden="true">
        <use href={`/assets/icons/sprite.svg#${icon}`} />
      </svg>
    </AriaButton>
  );
}
