// src/db/utc-day.ts — The UTC day boundary every daily budget resets on (#281).
// The model-call count and the stage-attempt cost are both "today" queries, so
// they must agree on where today starts.

/** The ISO timestamp of the start of the UTC day `date` falls in. */
export function startOfUtcDay(date = new Date()): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
