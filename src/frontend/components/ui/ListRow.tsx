// src/frontend/components/ui/ListRow.tsx — The list row block and the static
// placeholder rows a loading list shows (#251, spec #241).
//
// `ListRow` is one row: leading icon, title, optional subtitle, trailing slot.
// When it is pressable it is a React Aria Button, so Enter and Space work and
// the row is one tab stop. `PlaceholderRows` renders the same row element with
// placeholder content and no animation at all — static, never an animated
// loading effect — so a loading list holds exactly the height the loaded list
// will have, because both reserve `--list-row-height`.

import type { ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Link } from "react-router-dom";
import { withoutUndefined } from "./aria-props.js";

export interface ListRowProps {
  title: string;
  subtitle?: string | undefined;
  /** Sprite icon id (`/assets/icons/sprite.svg`), drawn before the title. */
  leadingIcon?: string | undefined;
  /** A badge or actions, pinned to the trailing edge. */
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  isDisabled?: boolean | undefined;
  /** The accessible name of a pressable row, when the title is not enough. */
  accessibleLabel?: string | undefined;
  /**
   * The row opens something at this path: it is a link, so the browser's own
   * link semantics (middle click, copy link, focus) keep working. One of
   * `href` and `onPress` decides what the row is.
   */
  href?: string | undefined;
  /** The row is the one the URL names: `aria-current="page"`. */
  isCurrent?: boolean | undefined;
  className?: string | undefined;
}

export function ListRow({
  title,
  subtitle,
  leadingIcon,
  trailing,
  onPress,
  isDisabled,
  accessibleLabel,
  href,
  isCurrent,
  className,
}: ListRowProps) {
  const content = (
    <>
      {leadingIcon !== undefined && (
        <svg className="icon icon-md" aria-hidden="true">
          <use href={`/assets/icons/sprite.svg#${leadingIcon}`} />
        </svg>
      )}
      <span className="ui-list-row-main">
        <span className="ui-list-row-title">{title}</span>
        {subtitle !== undefined && (
          <span className="ui-list-row-subtitle">{subtitle}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="ui-list-row-trailing">{trailing}</span>
      )}
    </>
  );

  if (href !== undefined) {
    const classes = ["ui-list-row", "ui-list-row--pressable"];
    if (className !== undefined) classes.push(className);
    return (
      <Link
        to={href}
        className={classes.join(" ")}
        data-list-row
        {...(accessibleLabel !== undefined
          ? { "aria-label": accessibleLabel }
          : {})}
        {...(isCurrent === true ? { "aria-current": "page" as const } : {})}
      >
        {content}
      </Link>
    );
  }

  if (onPress === undefined) {
    const classes = ["ui-list-row"];
    if (className !== undefined) classes.push(className);
    return <div className={classes.join(" ")}>{content}</div>;
  }

  const classes = ["ui-list-row", "ui-list-row--pressable"];
  if (className !== undefined) classes.push(className);
  return (
    <AriaButton
      className={classes.join(" ")}
      {...withoutUndefined({
        onPress,
        isDisabled,
        "aria-label": accessibleLabel,
      })}
    >
      {content}
    </AriaButton>
  );
}

export interface PlaceholderRowsProps {
  count?: number;
  className?: string | undefined;
}

/**
 * Static placeholder rows: the loading shape of a list. Hidden from assistive
 * technology — the region announces the wait itself — and never animated.
 */
export function PlaceholderRows({
  count = 3,
  className,
}: PlaceholderRowsProps) {
  const classes = ["ui-list-rows", "ui-list-rows--placeholder"];
  if (className !== undefined) classes.push(className);
  return (
    <ul className={classes.join(" ")} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows are anonymous and never reorder
        <li key={`placeholder-row-${index}`}>
          <div className="ui-list-row ui-list-row--placeholder">
            <span className="ui-list-row-main">
              <span className="ui-placeholder-line ui-placeholder-line--title" />
              <span className="ui-placeholder-line ui-placeholder-line--subtitle" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
