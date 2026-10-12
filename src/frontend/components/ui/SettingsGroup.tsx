// src/frontend/components/ui/SettingsGroup.tsx — The inset grouped list (#266,
// SYSTEM.md "Surfaces"): one --radius-card group on --bg-card, a footnote header
// above it and a footnote footer below, and rows that keep the title on the
// leading edge with its accessory trailing. Rows are at least --tap-min tall and
// separated by hairlines inset by the row's own padding.
//
// It is the one list shape the Settings panes and the welcome checklist share.
// The styles live in the shared layer (styles/shared/controls.css), never here —
// a block is a primitive of the system, not a component of a screen.
//
// `SettingsRow` renders the row inside its list item. A row that navigates
// renders the same box itself, so the element is the caller's choice:
//
//   <li>
//     <Link className="ui-settings-row ui-settings-row--pressable" to="/docs">
//       <SettingsRowContent title="Documentation" trailing={arrow} />
//     </Link>
//   </li>

import type { ReactNode } from "react";

export interface SettingsGroupProps {
  /** The group's header: a short, sentence-case name, never a colon. */
  title?: string | undefined;
  /** Notes under the group — what the rows above it mean or cost. */
  footer?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function SettingsGroup({
  title,
  footer,
  className,
  children,
}: SettingsGroupProps) {
  const classes = ["ui-settings-group"];
  if (className !== undefined) classes.push(className);
  return (
    <section className={classes.join(" ")}>
      {title !== undefined && (
        <h3 className="ui-settings-group-title">{title}</h3>
      )}
      <ul className="ui-settings-list">{children}</ul>
      {footer !== undefined && (
        <p className="ui-settings-group-footer">{footer}</p>
      )}
    </section>
  );
}

export interface SettingsRowContentProps {
  /** The row's title, on the leading edge. */
  title: string;
  /** A second line under the title, or a node (a combo line, a set of notes). */
  subtitle?: ReactNode;
  /** A mark before the title — the welcome checklist's ring. */
  leading?: ReactNode;
  /** The accessory, pinned to the trailing edge: a switch, a value, an action. */
  trailing?: ReactNode;
}

/** The row's box without the list item around it. */
export function SettingsRowContent({
  title,
  subtitle,
  leading,
  trailing,
}: SettingsRowContentProps) {
  return (
    <>
      {leading}
      <span className="ui-settings-row-main">
        <span className="ui-settings-row-title">{title}</span>
        {subtitle !== undefined && (
          <span className="ui-settings-row-subtitle">{subtitle}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="ui-settings-row-trailing">{trailing}</span>
      )}
    </>
  );
}

export interface SettingsRowProps extends SettingsRowContentProps {
  className?: string | undefined;
}

/** One row of a `SettingsGroup`, inside its list item. */
export function SettingsRow({ className, ...content }: SettingsRowProps) {
  const classes = ["ui-settings-row"];
  if (className !== undefined) classes.push(className);
  return (
    <li className={classes.join(" ")}>
      <SettingsRowContent {...content} />
    </li>
  );
}

export interface SettingsValueProps {
  children: ReactNode;
}

/**
 * A read-only value that trails a row — a path, a branch, an id. Mono and
 * muted because it is literal text the user reads or copies, never edits
 * (SYSTEM.md "Type"); a screen that offers a copy pairs it with an icon
 * button itself.
 */
export function SettingsValue({ children }: SettingsValueProps) {
  return <span className="ui-settings-row-value">{children}</span>;
}
