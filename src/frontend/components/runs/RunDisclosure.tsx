// src/frontend/components/runs/RunDisclosure.tsx — The one disclosure control of the run page.
//
// A stage row and a folded group of agent updates open the same way: a quiet
// row button with a trailing chevron that turns when it is open, the row's
// hover fill, and aria-expanded tied to the body it controls.

import type { ReactNode } from "react";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/Icon.js";

export interface RunDisclosureProps {
  id: string;
  /** The id of the body this row opens. */
  controls: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string | undefined;
  children: ReactNode;
}

export function RunDisclosure({
  id,
  controls,
  isOpen,
  onToggle,
  className,
  children,
}: RunDisclosureProps) {
  const classes = ["run-disclosure"];
  if (className !== undefined) classes.push(className);
  return (
    <Button
      variant="quiet"
      id={id}
      className={classes.join(" ")}
      aria-expanded={isOpen}
      aria-controls={controls}
      onPress={onToggle}
    >
      {children}
      <Icon
        name="icon-stage-chevron"
        size="sm"
        className="run-disclosure-chevron"
      />
    </Button>
  );
}
