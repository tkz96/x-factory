// The creation payload carries the base branch the user chose, else the
// provider's default branch.

import { describe, expect, it } from "bun:test";
import {
  buildCreationPayload,
  type DiscoveredRepositoryDetail,
} from "../src/frontend/wizard/steps/reviewPayload.js";

const discovered: DiscoveredRepositoryDetail[] = [
  { id: "a", name: "a", defaultBranch: "main" },
  { id: "b", name: "b", defaultBranch: "main" },
];

function payloadFor(repoConfigs: Record<string, { baseBranch?: string }>) {
  return buildCreationPayload(
    {
      basics: { name: "P", id: "p", description: "", workspacePath: "" },
      connect: { tracker: {}, gitHost: {}, providerConfigs: {} },
      repositories: {
        selectedRepoIds: ["a", "b"],
        primaryRepoId: "a",
        repoConfigs: Object.fromEntries(
          Object.entries(repoConfigs).map(([k, v]) => [
            k,
            { role: "gitHost", ...v },
          ]),
        ),
      },
    } as never,
    discovered,
    { name: "n", email: "n@example.com" },
  );
}

describe("buildCreationPayload base branch", () => {
  it("uses the chosen base branch, else the provider default", () => {
    const { repositories } = payloadFor({ a: { baseBranch: " develop " } });
    expect(repositories.find((r) => r.id === "a")?.defaultBranch).toBe(
      "develop",
    );
    expect(repositories.find((r) => r.id === "b")?.defaultBranch).toBe("main");
  });
});
