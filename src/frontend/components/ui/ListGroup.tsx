// src/frontend/components/ui/ListGroup.tsx — The one inset grouped list: a
// --radius-card container whose rows share inset hairlines instead of each row
// drawing its own box, an optional footnote header above it and footer below,
// and rows that keep the title on the leading edge with its accessory trailing.
//
// It is the shape the Settings panes, the welcome checklist, the Runs list and
// the Projects list all share, so a screen composes it instead of naming a
// class. The styles live in the shared layer (styles/shared/controls.css).
//
// <ListGroup title="Appearance" footer="Applies at once.">
// <ListGroupRow title="Theme" trailing="Default" />
// <ListGroupRow
// href="/docs"
// title="Documentation"
// trailing={<Arrow />}
// />
// </ListGroup>
//
// A row that both navigates and carries an action (which cannot live inside an
// anchor) passes `titleHref` instead of `href`: only its name is the link.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ListRowContent, type ListRowContentProps } from "./ListRow.js";

export interface ListGroupProps {
  /** The group's header: a short, sentence-case name, never a colon. */
  title?: string | undefined;
  /** Notes under the group — what the rows above it mean or cost. */
  footer?: string | undefined;
  /**
   * A `<ul>` by default. A list that wraps its rows in motion wrappers uses a
   * plain container, and keeps the same shape.
   */
  as?: "ul" | "div" | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** The container: optional header, the list, optional footer. */
export function ListGroup({
  title,
  footer,
  as = "ul",
  className,
  children,
}: ListGroupProps) {
  const classes = ["ui-list-group"];
  if (className !== undefined) classes.push(className);
  const list =
    as === "div" ? (
      <div className={classes.join(" ")} data-list>
        {children}
      </div>
    ) : (
      <ul className={classes.join(" ")} data-list>
        {children}
      </ul>
    );

  if (title === undefined && footer === undefined) return list;

  return (
    <section className="ui-list-group-block">
      {title !== undefined && <h3 className="ui-list-group-title">{title}</h3>}
      {list}
      {footer !== undefined && <p className="ui-list-group-footer">{footer}</p>}
    </section>
  );
}

export interface ListGroupRowProps extends ListRowContentProps {
  /** The row opens this path: the row itself is the link. */
  href?: string | undefined;
  /** The link opens elsewhere: a plain anchor, in a new tab. */
  isExternal?: boolean | undefined;
  /**
   * The accessible name of a navigating row, when the title is not enough.
   */
  accessibleLabel?: string | undefined;
  className?: string | undefined;
}

/** One row of a group, inside its list item. */
export function ListGroupRow({
  href,
  isExternal,
  accessibleLabel,
  className,
  ...content
}: ListGroupRowProps) {
  const body = <ListRowContent {...content} />;
  const classes = ["ui-list-row", "ui-list-row--compact"];
  if (href !== undefined || content.titleHref !== undefined) {
    classes.push("ui-list-row--pressable");
  }
  if (className !== undefined) classes.push(className);
  const classNames = classes.join(" ");

  if (href === undefined) {
    return <li className={classNames}>{body}</li>;
  }

  const name =
    accessibleLabel !== undefined ? { "aria-label": accessibleLabel } : {};
  return (
    <li>
      {isExternal === true ? (
        <a
          className={classNames}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-list-row
          {...name}
        >
          {body}
        </a>
      ) : (
        <Link className={classNames} to={href} data-list-row {...name}>
          {body}
        </Link>
      )}
    </li>
  );
}

export interface ListGroupValueProps {
  children: ReactNode;
}

/**
 * A read-only value that trails a row — a path, a branch, an id. Mono and muted
 * because it is literal text the user reads or copies, never edits; a screen
 * that offers a copy pairs it with an icon button itself.
 */
export function ListGroupValue({ children }: ListGroupValueProps) {
  return <span className="ui-list-row-value">{children}</span>;
}
