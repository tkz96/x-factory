// src/frontend/components/ui/Badge.tsx — The badge block (#251, spec #241).
//
// Presentational: a short state word, never an emoji (DESIGN.md §8). Warnings
// use the orange tones; nothing here is interactive, so it needs no React Aria
// primitive and no 44pt target.

import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "error";

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string | undefined;
  children: ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  const classes = ["ui-badge", `ui-badge--${tone}`];
  if (className !== undefined) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}
