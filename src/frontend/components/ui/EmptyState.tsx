// src/frontend/components/ui/EmptyState.tsx — The empty-state block (#297,
// spec #292 step 3).
//
// What is not here, once: a glyph, a title naming what is missing, one line of
// guidance and an optional action. Centred, with no card or box around it, the
// way macOS shows an empty view. AsyncRegion renders it for empty data; a
// screen renders it directly where no data load happens (for example, no
// search results). Every visual value comes from tokens and lives in
// src/frontend/styles/shared/controls.css.

import type { ReactNode } from "react";
import { Icon } from "./Icon.js";

export type EmptyStateHeadingLevel = 2 | 3 | 4;

export interface EmptyStateProps {
  /** Sprite icon id (`/assets/icons/sprite.svg`) that fits what is missing. */
  icon?: string | undefined;
  /** What is not here, in a few words. Rendered as a heading. */
  title?: ReactNode;
  /** One line of guidance: what to do next. Secondary label colour. */
  message?: ReactNode;
  /** An optional call to action, such as a Button or a link styled as one. */
  action?: ReactNode;
  /** The heading level of the title. Pages pick the level that fits their outline. */
  headingLevel?: EmptyStateHeadingLevel | undefined;
  className?: string | undefined;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const classes = ["ui-empty-state"];
  if (className !== undefined) classes.push(className);
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={classes.join(" ")}>
      {icon !== undefined && (
        <Icon name={icon} size="xl" className="ui-empty-state-icon" />
      )}
      {title !== undefined && (
        <Heading className="ui-empty-state-title">{title}</Heading>
      )}
      {message !== undefined && (
        <p className="ui-empty-state-message">{message}</p>
      )}
      {action !== undefined && (
        <div className="ui-empty-state-action">{action}</div>
      )}
    </div>
  );
}
