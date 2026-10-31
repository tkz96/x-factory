// src/frontend/lib/plural.ts — The one plural word helper the run page reads (#312 ticket 10).

/** "1 event" / "2 events": the word that matches the count. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
