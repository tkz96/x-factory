// src/frontend/components/ui/Badge.tsx — The badge block (#251, spec #241).
//
// Presentational: a short state word, never an emoji (DESIGN.md §8). Warnings
// use the orange tones; nothing here is interactive, so it needs no React Aria
// primitive and no 44pt target.
//
// One badge for the whole app: a capsule, sans, sentence case (the copy is
// written sentence-case, never text-transformed), a tint fill and no border
// (DESIGN.md §7 "Badges"). `variant="id"` is the mono literal variant for an id
// (GH-3), a keycap or a command.

import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "error";
export type BadgeVariant = "status" | "id";

export interface BadgeProps {
  tone?: BadgeTone;
  /** `status` (default) is the capsule; `id` is mono at --radius-xs, for a
   *  literal id, a keycap or a command. */
  variant?: BadgeVariant;
  /** Layout only — the look comes from the block. */
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Badge({
  tone = "neutral",
  variant = "status",
  id,
  className,
  children,
}: BadgeProps) {
  const classes = ["ui-badge", `ui-badge--${tone}`];
  if (variant === "id") classes.push("ui-badge--id");
  if (className !== undefined) classes.push(className);
  return (
    <span {...(id ? { id } : {})} className={classes.join(" ")}>
      {children}
    </span>
  );
}
