// The docs URL names a category and a slug; a missing slug falls back to that
// category's own default, never to a slug of another category (#325).
import { describe, expect, it } from "bun:test";
import { resolveDocsLocation } from "../src/frontend/lib/docs-location.js";

const at = (query: string) => resolveDocsLocation(new URLSearchParams(query));

describe("resolveDocsLocation", () => {
  it("opens the first tutorial with no parameters", () => {
    expect(at("")).toEqual({ category: "tutorials", slug: "first-agent-run" });
  });
  it("opens least-privilege for ?cat=security", () => {
    expect(at("cat=security")).toEqual({
      category: "security",
      slug: "least-privilege",
    });
  });
  it("never borrows the tutorial slug for another category", () => {
    expect(at("cat=how-to").slug).not.toBe("first-agent-run");
    expect(at("cat=how-to")).toEqual({ category: "how-to", slug: "" });
  });
  it("keeps a slug that is given", () => {
    expect(at("cat=security&slug=jira").slug).toBe("jira");
    expect(at("cat=how-to&slug=start-fresh").slug).toBe("start-fresh");
  });
  it("replaces an unknown security slug with the default", () => {
    expect(at("cat=security&slug=first-agent-run").slug).toBe(
      "least-privilege",
    );
  });
});
