// src/frontend/wizard/steps/repository-filter.ts — Filters discovered
// repositories by a typed query and lists the one already entered in the
// git-host connection first (#284).
//
// Provider-agnostic: the entered repository is recognised by comparing each
// row's name with the connection's string config values, never by a
// provider-specific field name.

interface FilterableRepository {
  readonly name: string;
  readonly remote: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns the rows whose name or remote contains `query` (case-insensitive),
 * with rows named after one of `configValues` first. Discovery order is kept
 * otherwise.
 */
export function filterAndOrderRepositories<T extends FilterableRepository>(
  rows: readonly T[],
  query: string,
  configValues: readonly unknown[],
): T[] {
  const needle = normalize(query);
  const entered = new Set(
    configValues
      .filter((v): v is string => typeof v === "string")
      .map(normalize)
      .filter(Boolean),
  );
  const matches = needle
    ? rows.filter(
        (row) =>
          normalize(row.name).includes(needle) ||
          normalize(row.remote).includes(needle),
      )
    : [...rows];
  const isEntered = (row: T) => entered.has(normalize(row.name));
  return [
    ...matches.filter(isEntered),
    ...matches.filter((r) => !isEntered(r)),
  ];
}
