// src/frontend/components/overlays/Menu.tsx — Menu primitive built on React Aria (#250).
//
// A dropdown of actions with arrow-key navigation, type-ahead and role="menu" /
// role="menuitem" structure. The Popover that holds the menu owns Escape and
// focus return, so the menu registers nothing of its own.

import "./Menu.css";

import type { ReactNode } from "react";
import {
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  type MenuItemProps as RACMenuItemProps,
  type MenuProps as RACMenuProps,
  MenuTrigger as RACMenuTrigger,
  Separator as RACSeparator,
} from "react-aria-components";

export const MenuTrigger = RACMenuTrigger;

export interface MenuProps<T> extends RACMenuProps<T> {
  className?: string;
  children: ReactNode;
}

export function Menu<T extends object>({
  className,
  children,
  ...props
}: MenuProps<T>) {
  return (
    <RACMenu className={`xf-menu ${className ?? ""}`.trim()} {...props}>
      {children}
    </RACMenu>
  );
}

export interface MenuItemProps extends RACMenuItemProps {
  isDanger?: boolean;
  className?: string;
  children: ReactNode;
}

export function MenuItem({
  isDanger = false,
  className,
  children,
  ...props
}: MenuItemProps) {
  const dangerClass = isDanger ? "xf-menu-item-danger" : "";
  return (
    <RACMenuItem
      className={`xf-menu-item ${dangerClass} ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </RACMenuItem>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return (
    <RACSeparator className={`xf-menu-separator ${className ?? ""}`.trim()} />
  );
}
