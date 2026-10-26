// src/frontend/components/ui/IconButton.tsx — The icon-only button block (#251).
//
// An icon-only control must have an accessible name (DESIGN.md §8), so `label`
// is required rather than optional.

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";
import { Icon } from "./Icon.js";

export type IconButtonVariant = "filled" | "plain";

export interface IconButtonProps
  extends Omit<
    AriaButtonProps,
    "className" | "children" | "onPress" | "id" | "isDisabled"
  > {
  /** The accessible name — never optional on an icon-only control. */
  label: string;
  /** Sprite icon id (`/assets/icons/sprite.svg`). */
  icon: string;
  /** `plain` draws no circle of its own: transparent until hovered or pressed.
   *  The toolbar's bell and gear wear it. Default: a filled circle. */
  variant?: IconButtonVariant;
  /** Content that rides inside the circle without sizing it — the bell's unread
   *  count. The circle itself never grows. */
  children?: ReactNode;
  className?: string | undefined;
  /** The press handler, narrowed to this vocabulary's shape. */
  onPress?: (() => void) | undefined;
  /** React Aria types these as `?: T` without `undefined`; the block drops
   *  undefined values, so a screen may build them conditionally (#287). */
  id?: string | undefined;
  isDisabled?: boolean | undefined;
}

export function IconButton({
  label,
  icon,
  variant = "filled",
  className,
  children,
  ...props
}: IconButtonProps) {
  const classes = ["ui-icon-button"];
  if (variant === "plain") classes.push("ui-icon-button--plain");
  if (className !== undefined) classes.push(className);
  return (
    <AriaButton
      {...withoutUndefined(props)}
      aria-label={label}
      className={classes.join(" ")}
    >
      <Icon name={icon} size="md" />
      {children}
    </AriaButton>
  );
}
