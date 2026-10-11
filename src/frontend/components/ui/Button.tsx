// src/frontend/components/ui/Button.tsx — The button block (#251, spec #241).
//
// The control vocabulary is built on React Aria's unstyled primitives with
// X-Factory's own tokens: React Aria owns behaviour (press, keyboard, focus
// visibility, disabled and touch semantics), tokens own every visual value.
// React Aria's own stylesheet is never imported — the classes live in
// src/frontend/styles/shared/controls.css.

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { withoutUndefined } from "./aria-props.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<AriaButtonProps, "className" | "children" | "onPress"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Sprite icon id (`/assets/icons/sprite.svg`), drawn before the label. */
  icon?: string;
  className?: string | undefined;
  children?: ReactNode;
  /** The press handler, narrowed to this vocabulary's shape. */
  onPress?: (() => void) | undefined;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = ["ui-button", `ui-button--${variant}`, `ui-button--${size}`];
  if (className !== undefined) classes.push(className);
  return (
    <AriaButton {...withoutUndefined(props)} className={classes.join(" ")}>
      {icon !== undefined && (
        <svg className="icon icon-sm" aria-hidden="true">
          <use href={`/assets/icons/sprite.svg#${icon}`} />
        </svg>
      )}
      {children}
    </AriaButton>
  );
}
