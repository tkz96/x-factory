import { describe, expect, it } from "bun:test";
import { isForeignProviderObject } from "../src/providers/discriminator.js";

describe("discriminator — isForeignProviderObject", () => {
  it("returns false for non-object or falsy inputs", () => {
    expect(isForeignProviderObject(null as never, "github")).toBe(false);
    expect(isForeignProviderObject(undefined as never, "github")).toBe(false);
  });

  it("identifies explicit foreign providerId and provider fields", () => {
    expect(isForeignProviderObject({ providerId: "azure" }, "github")).toBe(
      true,
    );
    expect(isForeignProviderObject({ providerId: "github" }, "github")).toBe(
      false,
    );
    expect(isForeignProviderObject({ provider: "jira" }, "github")).toBe(true);
    expect(isForeignProviderObject({ provider: "github" }, "github")).toBe(
      false,
    );
  });

  it("detects Jira signatures when target is github or azure", () => {
    expect(
      isForeignProviderObject({ host: "https://foo.atlassian.net" }, "github"),
    ).toBe(true);
    expect(isForeignProviderObject({ jiraToken: "secret" }, "azure")).toBe(
      true,
    );
    expect(
      isForeignProviderObject({ host: "https://foo.atlassian.net" }, "jira"),
    ).toBe(false);
  });

  it("detects Azure signatures when target is github or jira", () => {
    expect(
      isForeignProviderObject(
        { orgUrl: "https://dev.azure.com/org" },
        "github",
      ),
    ).toBe(true);
    expect(isForeignProviderObject({ pat: "token123" }, "jira")).toBe(true);
    expect(isForeignProviderObject({ azureProject: "proj" }, "github")).toBe(
      true,
    );
    expect(
      isForeignProviderObject({ orgUrl: "https://dev.azure.com/org" }, "azure"),
    ).toBe(false);
  });

  it("detects GitHub signatures when target is azure or jira", () => {
    expect(isForeignProviderObject({ repo: "my-repo" }, "azure")).toBe(true);
    expect(isForeignProviderObject({ githubToken: "gh-token" }, "jira")).toBe(
      true,
    );
    expect(isForeignProviderObject({ repo: "my-repo" }, "github")).toBe(false);
  });
});
