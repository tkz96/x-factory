// src/frontend/components/ui/Table.tsx — The table block (UI round 2).
//
// One table style for the app: an inset group (--radius-card, hairline row
// separators), mono only for ids, numbers right-aligned in tabular figures. It
// is a native <table>: the platform already gives a table its row and column
// semantics and its keyboard model, and a row can carry a detail row below it
// (a native colSpan) — which a grid widget makes awkward.
//
// The table is its own size container. Below 30rem it re-flows into stacked
// rows (each cell under the one before, numbers labelled by their column), so a
// phone never scrolls it sideways.

import type { ReactNode } from "react";

export type TableAlign = "start" | "end";
export type SortDirection = "ascending" | "descending";

export interface TableColumn {
  /** Stable key, used for sorting. */
  id: string;
  label: string;
  align?: TableAlign | undefined;
  /** The column can be sorted by pressing its header. */
  sortable?: boolean | undefined;
  /** The header is read by assistive tech but not drawn (an action column). */
  hideLabel?: boolean | undefined;
}

export interface TableSort {
  column: string;
  direction: SortDirection;
}

export interface TableProps {
  /** The table's accessible name. */
  label: string;
  columns: readonly TableColumn[];
  sort?: TableSort | undefined;
  onSortChange?: ((sort: TableSort) => void) | undefined;
  className?: string | undefined;
  /** TableRow / TableDetailRow children. */
  children: ReactNode;
}

function nextSort(current: TableSort | undefined, column: string): TableSort {
  if (current?.column === column) {
    return {
      column,
      direction: current.direction === "ascending" ? "descending" : "ascending",
    };
  }
  return { column, direction: "ascending" };
}

export function Table({
  label,
  columns,
  sort,
  onSortChange,
  className,
  children,
}: TableProps) {
  const classes = ["ui-table-frame"];
  if (className !== undefined) classes.push(className);
  return (
    <div className={classes.join(" ")}>
      <table className="ui-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sorted = sort?.column === column.id;
              const align = column.align === "end" ? " ui-table-cell--end" : "";
              return (
                <th
                  key={column.id}
                  scope="col"
                  className={`ui-table-head${align}`}
                  aria-sort={
                    column.sortable === true
                      ? sorted
                        ? sort.direction
                        : "none"
                      : undefined
                  }
                >
                  {column.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      className="ui-table-sort"
                      onClick={() => onSortChange(nextSort(sort, column.id))}
                    >
                      {column.label}
                      <svg
                        className={`icon icon-xs ui-table-sort-icon${
                          sorted ? " is-active" : ""
                        }${
                          sorted && sort.direction === "descending"
                            ? " is-descending"
                            : ""
                        }`}
                        aria-hidden="true"
                      >
                        <use href="/assets/icons/sprite.svg#icon-chevron-right" />
                      </svg>
                    </button>
                  ) : (
                    <span className={column.hideLabel ? "sr-only" : undefined}>
                      {column.label}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export interface TableRowProps {
  children: ReactNode;
  /** A row that is chosen / active reads as such (no border, a quiet fill). */
  isHighlighted?: boolean | undefined;
  className?: string | undefined;
}

export function TableRow({
  children,
  isHighlighted,
  className,
}: TableRowProps) {
  const classes = ["ui-table-row"];
  if (isHighlighted === true) classes.push("ui-table-row--highlighted");
  if (className !== undefined) classes.push(className);
  return <tr className={classes.join(" ")}>{children}</tr>;
}

export interface TableCellProps {
  children?: ReactNode;
  /** The column's label, shown beside the value when the table re-flows. */
  label?: string | undefined;
  align?: TableAlign | undefined;
  /** Numbers: right-aligned, tabular figures. */
  numeric?: boolean | undefined;
  /** The row's own name: drawn first and full-width when the table re-flows. */
  isRowHeader?: boolean | undefined;
  className?: string | undefined;
}

export function TableCell({
  children,
  label,
  align,
  numeric,
  isRowHeader,
  className,
}: TableCellProps) {
  const classes = ["ui-table-cell"];
  if (align === "end" || numeric === true) classes.push("ui-table-cell--end");
  if (numeric === true) classes.push("ui-table-cell--numeric");
  if (isRowHeader === true) classes.push("ui-table-cell--title");
  if (className !== undefined) classes.push(className);
  if (isRowHeader === true) {
    return (
      <th scope="row" className={classes.join(" ")}>
        {children}
      </th>
    );
  }
  return (
    <td
      className={classes.join(" ")}
      {...(label !== undefined ? { "data-label": label } : {})}
    >
      {children}
    </td>
  );
}

export interface TableDetailRowProps {
  /** How many columns the detail spans (the table's column count). */
  span: number;
  id?: string | undefined;
  children: ReactNode;
}

/** A full-width row under its parent row: an expanded editor, a note. */
export function TableDetailRow({ span, id, children }: TableDetailRowProps) {
  return (
    <tr className="ui-table-detail" {...(id !== undefined ? { id } : {})}>
      <td colSpan={span} className="ui-table-detail-cell">
        {children}
      </td>
    </tr>
  );
}
