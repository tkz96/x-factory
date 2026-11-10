// test/provider-list-branches.test.ts — listBranches for the GitHub and Azure
// DevOps providers, with the HTTP boundary faked.

import { describe, expect, it } from "bun:test";
import { createAzureProvider } from "../src/providers/azure-module.js";
import { createGithubProvider } from "../src/providers/github-module.js";
import { jsonResponse } from "./helpers/provider-test-helper.js";

describe("listBranches", () => {
  it("GitHub lists branch names across pages for the repository of the remote", async () => {
    const urls: string[] = [];
    const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return jsonResponse([{ name: "main" }, { name: "develop" }], {
          status: 200,
          headers: {
            link: '<https://api.github.com/repos/acme/app/branches?per_page=100&page=2>; rel="next"',
          },
        });
      }
      return jsonResponse([{ name: "release/1.0" }], { status: 200 });
    }) as typeof fetch;
    const provider = createGithubProvider({ fetchFn: fakeFetch });
    const branches = await provider.listBranches?.(
      { token: "ghp_x", repoOwner: "acme" },
      { id: "1", name: "app", remote: "https://github.com/acme/app.git" },
    );
    expect(branches).toEqual(["main", "develop", "release/1.0"]);
    expect(urls[0]).toContain("/repos/acme/app/branches");
  });

  it("Azure DevOps lists branch heads of the repository id, without the refs/heads/ prefix", async () => {
    let requested = "";
    const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
      requested = String(url);
      return jsonResponse(
        {
          value: [
            { name: "refs/heads/main" },
            { name: "refs/heads/feature/x" },
          ],
        },
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createAzureProvider({ fetchFn: fakeFetch });
    const branches = await provider.listBranches?.(
      { orgUrl: "https://dev.azure.com/org", project: "proj", pat: "p" },
      { id: "r1" },
    );
    expect(branches).toEqual(["main", "feature/x"]);
    expect(requested).toContain("/proj/_apis/git/repositories/r1/refs");
    expect(requested).toContain("filter=heads/");
  });
});
