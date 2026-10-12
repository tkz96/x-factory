// test/helpers/provider-error-fixture.ts — Real provider error payloads captured in a
// live end-to-end test, kept verbatim under test/fixtures/provider-errors/. Each file is
// one run event as the timeline stored it (`error|{"message": "<raw>"}`); `raw` is the
// error text the model session reported, exactly as a stage receives it.

import { readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dir, "..", "fixtures", "provider-errors");

export type ProviderErrorFixture =
  | "gemini-404-event"
  | "gemini-429-daily-quota-event";

/** The raw error text the session reported for `name`. */
export function providerErrorText(name: ProviderErrorFixture): string {
  const line = readFileSync(path.join(DIR, `${name}.txt`), "utf-8").trim();
  const json = line.slice(line.indexOf("|") + 1);
  return (JSON.parse(json) as { message: string }).message;
}
