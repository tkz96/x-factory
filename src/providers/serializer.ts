// src/providers/serializer.ts — Generic zod-to-descriptor serializer for provider config schemas.
//
// Decided in wayfinder #128 and ticket #137:
// Converts a strictly defined subset of Zod schemas into JSON-serializable
// field descriptors for the generic UI wizard.
//
// Invariants:
// - Fails loudly (SchemaSerializationError) on any schema construct outside the
//   strictly defined subset (unsupported types, transforms, refinements, missing metadata).
// - Requiredness comes strictly from the schema (isOptional), never metadata.
// - Metadata must not duplicate schema-derived properties (e.g. required: true is banned).
// - CRITICAL SECURITY INVARIANT: envKey is secret-routing metadata only and must NEVER
//   be included in client-facing field descriptors.
// - Cross-role field-name uniqueness is validated in plain code.

import type {
  Provider,
  ProviderCapability,
  ProviderConfigSchema,
  ProviderConfigUiType,
  ProviderRole,
} from "./contract.js";
import { hasCapability } from "./contract.js";

/** Typed error thrown when a schema violates the supported serialization subset. */
export class SchemaSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaSerializationError";
  }
}

/** Wire representation of a single provider configuration field. */
export interface ProviderConfigFieldDescriptor {
  name: string;
  label: string;
  type: ProviderConfigUiType;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  roles?: ProviderRole[];
}

/** Complete descriptor of a registered provider for UI consumption. */
export interface ProviderDescriptor {
  id: string;
  displayName: string;
  roles: ProviderRole[];
  iconRef: string;
  capabilities: ProviderCapability[];
  configFields: ProviderConfigFieldDescriptor[];
}

const KNOWN_CAPABILITIES: readonly ProviderCapability[] = [
  "verifyScopes",
  "listRepositories",
  "listTickets",
  "parseQuickUrl",
  "createPullRequest",
  "findExistingPullRequest",
];

const VALID_UI_TYPES = new Set<ProviderConfigUiType>([
  "text",
  "secret",
  "url",
  "email",
]);

const VALID_ROLES = new Set<ProviderRole>(["tracker", "gitHost"]);

const ALLOWED_METADATA_KEYS = new Set([
  "label",
  "uiType",
  "secret",
  "envKey",
  "placeholder",
  "help",
  "roles",
]);

interface ZodCheckLike {
  type?: string;
  check?: string;
  _zod?: {
    def?: { type?: string; check?: string; fn?: unknown; format?: string };
  };
  _def?: { type?: string; check?: string; fn?: unknown; format?: string };
  fn?: unknown;
  format?: string;
}

interface ZodFieldLike {
  _def?: {
    type?: string;
    innerType?: ZodFieldLike;
    checks?: ZodCheckLike[];
  };
  meta?: () => Record<string, unknown> | undefined;
  isOptional?: () => boolean;
}

/**
 * Validates cross-role field-name uniqueness in plain code.
 * Ensures a field name identifies one provider configuration property.
 */
export function validateCrossRoleFieldUniqueness(
  fields: readonly ProviderConfigFieldDescriptor[],
): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) {
      throw new SchemaSerializationError(
        `Cross-role field-name uniqueness violation: Duplicate field name "${field.name}". A field name must identify one provider configuration property.`,
      );
    }
    seen.add(field.name);
  }
}

/** Returns the optional capabilities implemented by a provider. */
export function getProviderCapabilities(
  provider: Provider,
): ProviderCapability[] {
  return KNOWN_CAPABILITIES.filter((cap) => hasCapability(provider, cap));
}

/**
 * Serializes a provider's zod configSchema into UI field descriptors.
 * Throws SchemaSerializationError if any construct violates the defined subset.
 */
export function serializeProviderConfigSchema(
  schema: ProviderConfigSchema,
): ProviderConfigFieldDescriptor[] {
  if (
    !schema ||
    typeof schema !== "object" ||
    !("_def" in schema) ||
    (schema as { _def?: { type?: string } })._def?.type !== "object" ||
    !("shape" in schema) ||
    typeof (schema as { shape?: unknown }).shape !== "object" ||
    (schema as { shape?: unknown }).shape === null
  ) {
    throw new SchemaSerializationError(
      "Provider config schema must be a ZodObject.",
    );
  }

  const shape = (schema as { shape: Record<string, unknown> }).shape;
  const descriptors: ProviderConfigFieldDescriptor[] = [];

  for (const [name, fieldSchema] of Object.entries(shape)) {
    if (
      !fieldSchema ||
      typeof fieldSchema !== "object" ||
      !("_def" in fieldSchema)
    ) {
      throw new SchemaSerializationError(
        `Field "${name}" is not a valid Zod schema.`,
      );
    }

    let cur: ZodFieldLike = fieldSchema as ZodFieldLike;
    let isOptional = false;
    let meta: Record<string, unknown> | undefined =
      typeof cur.meta === "function" ? cur.meta() : undefined;

    if (typeof cur.isOptional === "function" && cur.isOptional()) {
      isOptional = true;
    }

    // Unwrap allowed wrappers: optional, default
    while (cur?._def?.innerType) {
      const defType = cur._def?.type;
      if (defType !== "optional" && defType !== "default") {
        throw new SchemaSerializationError(
          `Field "${name}" has unsupported wrapper type "${defType}". Only optional and default wrappers are supported.`,
        );
      }
      if (defType === "optional") {
        isOptional = true;
      }
      cur = cur._def.innerType;
      if (!meta && typeof cur.meta === "function") {
        meta = cur.meta();
      }
    }

    const coreType = cur?._def?.type;
    if (coreType !== "string") {
      throw new SchemaSerializationError(
        `Field "${name}" has unsupported type "${coreType}". Provider config schemas only support string fields.`,
      );
    }

    // Detect unsupported refinements or pipes
    if (cur._def?.type === "pipe") {
      throw new SchemaSerializationError(
        `Field "${name}" contains unsupported pipe or transform. Transforms cannot be serialized.`,
      );
    }

    const checks = cur._def?.checks;
    if (Array.isArray(checks)) {
      for (const check of checks) {
        const checkDef = check?._zod?.def ?? check?._def ?? check;
        const checkType = checkDef?.check ?? checkDef?.type ?? check?.type;
        const allowedChecks = [
          "min_length",
          "max_length",
          "string_format",
          "overwrite",
        ];

        if (
          typeof checkType === "string" &&
          !allowedChecks.includes(checkType)
        ) {
          throw new SchemaSerializationError(
            `Field "${name}" contains unsupported check "${checkType}". Only min, max, url, email, trim are allowed.`,
          );
        }

        if (checkType === "string_format") {
          const format = checkDef?.format;
          if (format !== "url" && format !== "email") {
            throw new SchemaSerializationError(
              `Field "${name}" contains unsupported string format "${format}". Only url and email are allowed.`,
            );
          }
        }

        if (checkType === "custom" || typeof checkDef?.fn === "function") {
          throw new SchemaSerializationError(
            `Field "${name}" contains unsupported refinement. Custom refinements cannot be serialized.`,
          );
        }
      }
    }

    // Validate metadata
    if (!meta || typeof meta !== "object") {
      throw new SchemaSerializationError(
        `Field "${name}" is missing metadata. All provider config fields must declare metadata via .meta(...)`,
      );
    }

    if ("required" in meta) {
      throw new SchemaSerializationError(
        `Field "${name}" duplicates schema-derived property "required" in metadata. Requiredness must come from the schema itself.`,
      );
    }

    for (const key of Object.keys(meta)) {
      if (!ALLOWED_METADATA_KEYS.has(key)) {
        throw new SchemaSerializationError(
          `Field "${name}" has unknown metadata property "${key}".`,
        );
      }
    }

    const label = meta.label;
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new SchemaSerializationError(
        `Field "${name}" metadata must provide a non-empty string "label".`,
      );
    }

    const uiType = meta.uiType as ProviderConfigUiType;
    if (typeof uiType !== "string" || !VALID_UI_TYPES.has(uiType)) {
      throw new SchemaSerializationError(
        `Field "${name}" metadata has invalid uiType: "${uiType}". Allowed: text, secret, url, email.`,
      );
    }

    const isSecret = meta.secret === true;
    if (isSecret) {
      if (uiType !== "secret") {
        throw new SchemaSerializationError(
          `Field "${name}" has secret: true but uiType is "${uiType}". Secret fields must have uiType "secret".`,
        );
      }
      if (typeof meta.envKey !== "string" || meta.envKey.trim().length === 0) {
        throw new SchemaSerializationError(
          `Field "${name}" is marked secret but is missing "envKey". Secret fields must declare envKey for environment storage.`,
        );
      }
    }

    if (uiType === "secret" && !isSecret) {
      throw new SchemaSerializationError(
        `Field "${name}" has uiType "secret" but secret is not true.`,
      );
    }

    if (!isSecret && "envKey" in meta) {
      throw new SchemaSerializationError(
        `Non-secret field "${name}" must not declare "envKey".`,
      );
    }

    let roles: ProviderRole[] | undefined;
    if ("roles" in meta && meta.roles !== undefined) {
      if (!Array.isArray(meta.roles) || meta.roles.length === 0) {
        throw new SchemaSerializationError(
          `Field "${name}" metadata "roles" must be a non-empty array of ProviderRole.`,
        );
      }
      for (const r of meta.roles as ProviderRole[]) {
        if (!VALID_ROLES.has(r)) {
          throw new SchemaSerializationError(
            `Field "${name}" metadata roles contains invalid role "${r}".`,
          );
        }
      }
      roles = [...(meta.roles as ProviderRole[])];
    }

    if (
      "placeholder" in meta &&
      meta.placeholder !== undefined &&
      typeof meta.placeholder !== "string"
    ) {
      throw new SchemaSerializationError(
        `Field "${name}" metadata "placeholder" must be a string.`,
      );
    }

    if (
      "help" in meta &&
      meta.help !== undefined &&
      typeof meta.help !== "string"
    ) {
      throw new SchemaSerializationError(
        `Field "${name}" metadata "help" must be a string.`,
      );
    }

    // Build the descriptor — NEVER copy envKey into client-facing descriptor!
    const descriptor: ProviderConfigFieldDescriptor = {
      name,
      label,
      type: uiType,
      required: !isOptional,
    };

    if (isSecret) {
      descriptor.secret = true;
    }
    if (typeof meta.placeholder === "string") {
      descriptor.placeholder = meta.placeholder;
    }
    if (typeof meta.help === "string") {
      descriptor.help = meta.help;
    }
    if (roles) {
      descriptor.roles = roles;
    }

    descriptors.push(descriptor);
  }

  validateCrossRoleFieldUniqueness(descriptors);
  return descriptors;
}

/**
 * Serializes a Provider instance into a ProviderDescriptor, with optional role filtering.
 * Returns null if roleFilter is provided and the provider does not support that role.
 */
export function serializeProvider(
  provider: Provider,
  roleFilter?: ProviderRole,
): ProviderDescriptor | null {
  if (roleFilter && !provider.roles.includes(roleFilter)) {
    return null;
  }

  const allFields = serializeProviderConfigSchema(provider.configSchema);
  const configFields = roleFilter
    ? allFields.filter(
        (f) => !f.roles || f.roles.length === 0 || f.roles.includes(roleFilter),
      )
    : allFields;

  validateCrossRoleFieldUniqueness(configFields);

  return {
    id: provider.id,
    displayName: provider.displayName,
    roles: [...provider.roles],
    iconRef: provider.iconRef,
    capabilities: getProviderCapabilities(provider),
    configFields,
  };
}
