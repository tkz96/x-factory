// The default base URLs are one constant in src/shared, used by the server and
// the Settings panel (#325).
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_BASE_URLS as server } from "../src/model-connections.js";
import { DEFAULT_BASE_URLS as shared } from "../src/shared/model-connection-types.js";

describe("DEFAULT_BASE_URLS", () => {
  it("is the same object for the server and the shared module", () => {
    expect(server).toBe(shared);
    expect(shared.anthropic).toBe("https://api.anthropic.com");
  });
  it("is not copied in the panel", async () => {
    const src = await readFile(
      "src/frontend/components/settings/ModelConnectionsPanel.tsx",
      "utf8",
    );
    expect(src).not.toContain("generativelanguage.googleapis.com");
  });
});
