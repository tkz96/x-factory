// test/wizard-url.test.ts — Unit tests for wizard URL parsing and repository role inference.

import { describe, expect, it } from "bun:test";
import {
  inferRepoRole,
  parseQuickUrl,
} from "../src/frontend/lib/wizard-url.js";

describe("Wizard URL Parsing & Role Inference (src/frontend/lib/wizard-url.ts)", () => {
  it("parses Azure DevOps dev.azure.com URL", () => {
    const res = parseQuickUrl("https://dev.azure.com/my-org/my-project");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("azure");
    if (res?.provider === "azure") {
      expect(res.org).toBe("my-org");
      expect(res.project).toBe("my-project");
      expect(res.orgUrl).toBe("https://dev.azure.com/my-org");
    }
  });

  it("parses Azure DevOps visualstudio.com URL and strips .git", () => {
    const res = parseQuickUrl("my-org.visualstudio.com/cool-project.git");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("azure");
    if (res?.provider === "azure") {
      expect(res.org).toBe("my-org");
      expect(res.project).toBe("cool-project");
    }
  });

  it("parses GitHub repository URL and strips .git", () => {
    const res = parseQuickUrl(
      "https://github.com/tkz96/simple-hello-world.git",
    );
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("github");
    if (res?.provider === "github") {
      expect(res.owner).toBe("tkz96");
      expect(res.repo).toBe("simple-hello-world");
    }
  });

  it("parses standard GitHub repository URL", () => {
    const res = parseQuickUrl("https://github.com/tkz96/simple-hello-world");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("github");
    if (res?.provider === "github") {
      expect(res.owner).toBe("tkz96");
      expect(res.repo).toBe("simple-hello-world");
    }
  });

  it("returns null for non-matching URLs or empty input", () => {
    expect(parseQuickUrl("")).toBeNull();
    expect(parseQuickUrl("https://google.com")).toBeNull();
    expect(parseQuickUrl("just-some-random-text")).toBeNull();
  });

  it("infers repository role correctly based on keywords", () => {
    expect(inferRepoRole("app-frontend")).toBe("frontend");
    expect(inferRepoRole("web-portal")).toBe("frontend");
    expect(inferRepoRole("core-api")).toBe("backend");
    expect(inferRepoRole("data-worker")).toBe("worker");
    expect(inferRepoRole("cloud-infra")).toBe("infrastructure");
    expect(inferRepoRole("docs-knowledge")).toBe("knowledge");
    expect(inferRepoRole("graph-store")).toBe("knowledge");
    expect(inferRepoRole("utilities")).toBe("other");
  });
});
