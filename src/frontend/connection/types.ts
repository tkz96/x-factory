// src/frontend/connection/types.ts — Wire types for the provider HTTP boundary (spec #133, ticket #143).
// Re-declared in the frontend to avoid importing backend provider modules.

export type ProviderConfigUiType = "text" | "secret" | "url" | "email";

export interface ProviderConfigFieldDescriptor {
  name: string;
  label: string;
  type: ProviderConfigUiType;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  roles?: ("tracker" | "gitHost")[];
}

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  roles: ("tracker" | "gitHost")[];
  iconRef: string;
  capabilities: string[];
  configFields: ProviderConfigFieldDescriptor[];
}

export interface VerificationWarning {
  kind: "CAPABILITY_UNCONFIRMED";
  capability: string;
}

export interface VerificationResult {
  status: "ok" | "degraded";
  warnings: VerificationWarning[];
}

export type ParseUrlResult =
  | {
      matched: true;
      providerId: string;
      configDraft: Record<string, unknown>;
      inferredName?: string;
    }
  | {
      matched: false;
      url: string;
    };

export interface VerifyCredentialsPayload {
  providerId: string;
  role: "tracker" | "gitHost";
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Repository discovery (spec #133, ticket #144)
// ---------------------------------------------------------------------------

/** One repository as discovered by the git-host provider. */
export interface ProviderRepository {
  id: string;
  name: string;
  remote: string;
  defaultBranch?: string;
  webUrl?: string;
}

/** Provider-agnostic discovery envelope returned by the providers API. */
export interface RepositoriesEnvelope {
  providerId: string;
  /** Connection roles the repositories were listed under. */
  roles: string[];
  repositories: ProviderRepository[];
}

export interface DiscoverRepositoriesPayload {
  providerId: string;
  role: "tracker" | "gitHost";
  config: Record<string, unknown>;
}
