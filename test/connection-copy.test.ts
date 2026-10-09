import { describe, expect, it } from "bun:test";
import type { ConnectionWarning } from "../src/frontend/components/connections/connection-view.js";
import { formatConnectionWarnings } from "../src/frontend/components/projects/connection-copy.js";

describe("connection-copy — formatConnectionWarnings", () => {
  it("formats ROLE_NOT_RECORDED warning", () => {
    const warning: ConnectionWarning = {
      kind: "ROLE_NOT_RECORDED",
      role: "tracker",
      details: ["tracker"],
    };
    const result = formatConnectionWarnings([warning]);
    expect(result.length).toBe(1);
    expect(result[0]).toContain(
      "No issue tracker connection is recorded on this project.",
    );
  });

  it("formats CONFIG_INCOMPLETE warning", () => {
    const warning: ConnectionWarning = {
      kind: "CONFIG_INCOMPLETE",
      role: "gitHost",
      details: ["apiToken"],
    };
    const result = formatConnectionWarnings([warning]);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("apiToken");
  });

  it("formats PROVIDER_UNKNOWN warning", () => {
    const warning: ConnectionWarning = {
      kind: "PROVIDER_UNKNOWN",
      role: "tracker",
      details: ["custom-unknown"],
    };
    const result = formatConnectionWarnings([warning]);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("custom-unknown");
  });
});
