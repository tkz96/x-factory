// test/provider-secret-routing.test.ts — Unit tests for generic secret
// routing, config validation codes and redaction (#145).
//
// The server derives what is secret and where it is stored from the registered
// provider's own schema: client-supplied metadata is never trusted, and no
// provider conditional exists in these paths.

import { describe, expect, it } from "bun:test";
import { z } from "zod/v4";
import { azureConfigSchema } from "../src/providers/azure-module.js";
import {
  fieldErrorCodes,
  parseProviderConfig,
} from "../src/providers/config-validation.js";
import type { ProviderConfigSchema } from "../src/providers/contract.js";
import { jiraConfigSchema } from "../src/providers/jira-module.js";
import {
  REDACTED_SECRET_VALUE,
  redactConfigForProvider,
  redactConnections,
  redactProviderConfig,
} from "../src/providers/redaction.js";
import {
  getSecretFieldRoutes,
  routeConnectionSecrets,
} from "../src/providers/secret-routing.js";
import { stubConfigSchema } from "./fixtures/stub-provider.js";

describe("getSecretFieldRoutes", () => {
  it("reads the declared secret fields and their env targets from a schema", () => {
    expect(getSecretFieldRoutes(stubConfigSchema)).toEqual([
      { name: "apiToken", envKey: "STUB_API_TOKEN" },
    ]);
  });

  it("derives routes for every registered provider without provider conditionals", () => {
    expect(getSecretFieldRoutes(azureConfigSchema)).toEqual([
      { name: "pat", envKey: "AZURE_DEVOPS_PAT" },
    ]);
    expect(getSecretFieldRoutes(jiraConfigSchema)).toEqual([
      { name: "apiToken", envKey: "JIRA_API_TOKEN" },
    ]);
  });

  it("returns nothing for a schema with no secret fields", () => {
    const schema = z.object({
      host: z.string().min(1).meta({ label: "Host", uiType: "url" }),
    });
    expect(getSecretFieldRoutes(schema)).toEqual([]);
  });

  it("fails loudly when a secret field declares no envKey", () => {
    const schema = z.object({
      apiToken: z.string().meta({
        label: "API token",
        uiType: "secret",
        secret: true,
      } as never),
    });
    expect(() => getSecretFieldRoutes(schema)).toThrow(/missing "envKey"/);
  });
});

describe("routeConnectionSecrets", () => {
  it("strips secret fields from the persisted config and routes their values to env keys", () => {
    const { config, secrets } = routeConnectionSecrets(stubConfigSchema, {
      host: "https://stub.example",
      apiToken: "synthetic-token-abcd",
      project: "rocket",
    });

    expect(config).toEqual({ host: "https://stub.example", project: "rocket" });
    expect(secrets).toEqual({ STUB_API_TOKEN: "synthetic-token-abcd" });
  });

  it("never trusts client-supplied metadata to decide what is secret or where it goes", () => {
    const { config, secrets } = routeConnectionSecrets(stubConfigSchema, {
      host: "https://stub.example",
      project: "rocket",
      apiToken: "synthetic-token-abcd",
      // Client metadata claiming a different secret field and env target.
      envKey: "ATTACKER_CHOSEN_KEY",
      secret: true,
      stolenToken: { secret: true, envKey: "ATTACKER_CHOSEN_KEY" },
    });

    // The declared field is the only one routed, under its declared key.
    expect(secrets).toEqual({ STUB_API_TOKEN: "synthetic-token-abcd" });
    expect(Object.keys(secrets)).not.toContain("ATTACKER_CHOSEN_KEY");
    // Undeclared fields are not treated as secrets by the routing itself.
    expect(config.stolenToken).toEqual({
      secret: true,
      envKey: "ATTACKER_CHOSEN_KEY",
    });
  });

  it("routes nothing for a missing or empty secret value (keep, never delete)", () => {
    expect(
      routeConnectionSecrets(stubConfigSchema, { host: "h", project: "p" })
        .secrets,
    ).toEqual({});
    expect(
      routeConnectionSecrets(stubConfigSchema, {
        host: "h",
        project: "p",
        apiToken: "   ",
      }).secrets,
    ).toEqual({});
  });
});

describe("redactProviderConfig", () => {
  it("masks every declared secret value and leaves the rest untouched", () => {
    const redacted = redactProviderConfig(stubConfigSchema, {
      host: "https://stub.example",
      apiToken: "synthetic-token-abcd",
      project: "rocket",
    });

    expect(redacted).toEqual({
      host: "https://stub.example",
      apiToken: REDACTED_SECRET_VALUE,
      project: "rocket",
    });
  });

  it("leaves missing and empty secrets alone", () => {
    expect(
      redactProviderConfig(stubConfigSchema, { host: "h", apiToken: "" }),
    ).toEqual({ host: "h", apiToken: "" });
  });

  it("masks stored connection configs through their registered provider", () => {
    const connections = redactConnections(
      [
        {
          providerId: "stub",
          roles: ["tracker"],
          config: {
            host: "https://stub.example",
            apiToken: "synthetic-token-abcd",
          },
        },
      ],
      new Map([["stub", { configSchema: stubConfigSchema }]]),
    );

    expect(connections?.[0]?.config.apiToken).toBe(REDACTED_SECRET_VALUE);
    expect(connections?.[0]?.roles).toEqual(["tracker"]);
  });

  it("leaves an unregistered provider's config as-is rather than guessing", () => {
    const config = { host: "https://unknown.example", apiToken: "value" };
    expect(redactConfigForProvider(undefined, config)).toEqual(config);
  });
});

describe("parseProviderConfig", () => {
  it("returns the schema-sanitized config on success", () => {
    const result = parseProviderConfig(stubConfigSchema, {
      host: "https://stub.example",
      apiToken: "token",
      project: "rocket",
      undeclared: "value",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        host: "https://stub.example",
        apiToken: "token",
        project: "rocket",
      });
    }
  });

  it("codes absent fields REQUIRED and present-but-invalid fields INVALID", () => {
    const missing = parseProviderConfig(stubConfigSchema, {
      host: "https://stub.example",
      project: "rocket",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.fieldErrors).toEqual({ apiToken: "REQUIRED" });
    }

    const invalid = parseProviderConfig(azureConfigSchema, {
      orgUrl: "not-a-url",
      project: "proj",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.fieldErrors).toEqual({ orgUrl: "INVALID" });
  });

  it("maps issues with no config path to a form-level code", () => {
    const schema = z
      .object({ host: z.string().min(1) })
      .refine((v) => v.host.length > 3);
    const result = parseProviderConfig(schema as ProviderConfigSchema, {
      host: "a",
    });
    expect(result.ok).toBe(false);
    // A root-level issue has no field to address, so it maps to the
    // form-level "config" key (the value is absent, hence REQUIRED).
    if (!result.ok) expect(result.fieldErrors).toEqual({ config: "REQUIRED" });
  });
});

describe("fieldErrorCodes", () => {
  it("treats null as an absent (REQUIRED) value", () => {
    const parsed = stubConfigSchema.safeParse({
      host: "https://stub.example",
      apiToken: null,
      project: "rocket",
    });
    if (parsed.success) throw new Error("expected a schema failure");
    expect(fieldErrorCodes(parsed.error, { apiToken: null })).toEqual({
      apiToken: "REQUIRED",
    });
  });
});
