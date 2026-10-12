// test/repository-filter.test.ts — filtering and ordering of discovered
// repositories in the wizard's Repositories step (#284).

import { describe, expect, it } from "bun:test";
import { filterAndOrderRepositories } from "../src/frontend/wizard/steps/repository-filter.js";

const rows = [
  { id: "1", name: "alpha", remote: "https://git.example.com/acme/alpha.git" },
  {
    id: "2",
    name: "x-factory",
    remote: "https://github.com/tkz96/x-factory.git",
  },
  {
    id: "3",
    name: "beta-service",
    remote: "https://git.example.com/acme/beta-service.git",
  },
];

describe("filterAndOrderRepositories", () => {
  it("keeps the discovery order when there is no query and no entered repository", () => {
    expect(filterAndOrderRepositories(rows, "", []).map((r) => r.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("puts the repository already entered in the connection first", () => {
    const ordered = filterAndOrderRepositories(rows, "", [
      "tkz96",
      "x-factory",
      "https://api.github.com",
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("matches the entered repository case-insensitively and ignores non-string config values", () => {
    const ordered = filterAndOrderRepositories(rows, "", [
      42,
      null,
      "  X-Factory ",
    ]);
    expect(ordered[0]?.id).toBe("2");
  });

  it("filters by name or remote, case-insensitively", () => {
    expect(
      filterAndOrderRepositories(rows, "BETA", []).map((r) => r.id),
    ).toEqual(["3"]);
    expect(
      filterAndOrderRepositories(rows, "tkz96", []).map((r) => r.id),
    ).toEqual(["2"]);
  });

  it("treats a whitespace-only query as no filter", () => {
    expect(filterAndOrderRepositories(rows, "   ", []).length).toBe(3);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAndOrderRepositories(rows, "nope", [])).toEqual([]);
  });
});
