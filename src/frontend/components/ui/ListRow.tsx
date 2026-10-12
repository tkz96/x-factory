// src/frontend/components/ui/ListRow.tsx — The one grouped-list row: its content
// box, the row element around it, and the static placeholder rows a loading list
// shows (#251, spec #241). `ListGroup.tsx` is the group it sits in.
//
// `ListRowContent` is the box: leading mark, title, optional subtitle, trailing
// accessory — one markup and one set of classes for every grouped list in the
// app (Runs, Projects, Settings and the welcome checklist).
//
// `ListRow` is the row element for a list of records: a React Aria Button when
// it presses, a link when it opens a path, else a plain box. When it is
// pressable, Enter and Space work and the row is one tab stop.
//
// `PlaceholderRows` renders the same row element with placeholder content and no
// animation at all — static, never an animated loading effect — so a loading
// list holds exactly the height the loaded list will have: both reserve
// `--list-row-height`.

import type { ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Link } from "react-router-dom";
import { withoutUndefined } from "./aria-props.js";

export interface ListRowContentProps {
  /** The row's title, on the leading edge. */
  title: string;
  /**
   * A checklist's rows are the screen's sections: render the title as this
   * heading level instead of a plain span.
   */
  titleHeadingLevel?: 2 | 3 | undefined;
  /**
   * The row's own name carries the navigation, because the row also carries an
   * action that cannot live inside an anchor.
   */
  titleHref?: string | undefined;
  /** A second line under the title, or a node (a combo line, a set of notes). */
  subtitle?: ReactNode;
  /** A mark before the title — a checklist's ring. */
  leading?: ReactNode;
  /** Sprite icon id (`/assets/icons/sprite.svg`), drawn before the title. */
  leadingIcon?: string | undefined;
  /** The accessory, pinned to the trailing edge: a switch, a value, an action. */
  trailing?: ReactNode;
}

/** The row's box, without the list item or the element around it. */
export function ListRowContent({
  title,
  titleHeadingLevel,
  titleHref,
  subtitle,
  leading,
  leadingIcon,
  trailing,
}: ListRowContentProps) {
  const Title =
    titleHeadingLevel === 2 ? "h2" : titleHeadingLevel === 3 ? "h3" : "span";
  const body = (
    <>
      <Title className="ui-list-row-title">{title}</Title>
      {subtitle !== undefined && (
        <span className="ui-list-row-subtitle">{subtitle}</span>
      )}
    </>
  );
  return (
    <>
      {leading}
      {leadingIcon !== undefined && (
        <svg className="icon icon-md" aria-hidden="true">
          <use href={`/assets/icons/sprite.svg#${leadingIcon}`} />
        </svg>
      )}
      {titleHref === undefined ? (
        <span className="ui-list-row-main">{body}</span>
      ) : (
        <Link to={titleHref} className="ui-list-row-main ui-list-row-main--link">
          {body}
        </Link>
      )}
      {trailing !== undefined && (
        <span className="ui-list-row-trailing">{trailing}</span>
      )}
    </>
  );
}

export interface ListRowProps extends ListRowContentProps {
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
  titleHeadingLevel,
  titleHref,
  subtitle,
  leading,
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
    <ListRowContent
      title={title}
      titleHeadingLevel={titleHeadingLevel}
      titleHref={titleHref}
      subtitle={subtitle}
      leading={leading}
      leadingIcon={leadingIcon}
      trailing={trailing}
    />
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
  /** The reserved rows wear the group's box, so a loading list matches it. */
  group?: boolean;
  className?: string | undefined;
}

/**
 * Static placeholder rows: the loading shape of a list. Hidden from assistive
 * technology — the region announces the wait itself — and never animated.
 */
export function PlaceholderRows({
  count = 3,
  group = false,
  className,
}: PlaceholderRowsProps) {
  const classes = ["ui-list-rows", "ui-list-rows--placeholder"];
  if (group) classes.push("ui-list-group");
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
