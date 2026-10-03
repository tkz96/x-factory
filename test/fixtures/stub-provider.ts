// test/fixtures/stub-provider.ts — A minimal provider used to prove the
// registry-injection extensibility gate (wayfinder #127, acceptance gate a):
// this stub functions through the contract with zero edits to any
// production module. It deliberately implements only some capabilities so
// the `hasCapability` guard exercises both its true and false paths.

import { z } from "zod/v4";
import type {
  Provider,
  ProviderConfigFieldMeta,
  ProviderErrorContext,
  ScopeVerificationReport,
} from "../../src/providers/contract.js";

const hostMeta: ProviderConfigFieldMeta = { label: "Host", uiType: "url" };
const apiTokenMeta: ProviderConfigFieldMeta = {
  label: "API token",
  uiType: "secret",
  secret: true,
  envKey: "STUB_API_TOKEN",
  help: "Stored in per-project environment storage.",
};
const projectMeta: ProviderConfigFieldMeta = {
  label: "Project",
  uiType: "text",
};

export const stubConfigSchema = z.object({
  host: z.string().min(1).meta(hostMeta),
  apiToken: z.string().min(1).meta(apiTokenMeta),
  project: z.string().min(1).meta(projectMeta),
});

export const stubProvider: Provider = {
  id: "stub",
  displayName: "Stub Provider",
  roles: ["tracker", "gitHost"],
  iconRef: "provider-stub",
  configSchema: stubConfigSchema,
  async verifyCredentials(_config) {
    return { status: "ok", warnings: [] };
  },
  toUserError(_raw, context: ProviderErrorContext) {
    return { code: "AUTH_INVALID", context };
  },
  async verifyScopes(_config): Promise<ScopeVerificationReport> {
    return {
      findings: [{ capability: "listTickets", status: "confirmed" }],
      overPrivileged: false,
    };
  },
  parseQuickUrl(url) {
    const match = /^https:\/\/stub\.example\/[^/]+\/([^/]+)/.exec(url);
    const name = match?.[1];
    if (!name) {
      return null;
    }
    return {
      configDraft: { host: "https://stub.example", project: name },
      inferredName: name,
    };
  },
};
