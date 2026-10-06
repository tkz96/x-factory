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

import { z } from "zod";
import type {
  Provider,
  ProviderCapability,
  ProviderConfigUiType,
  ProviderRole,
} from "./contract.js";
import { hasCapability } from "./contract.js";
import {
  type ProviderConfigFieldSchema,
  readConfigFieldSchemas,
  SchemaSerializationError,
  unwrapConfigField,
} from "./schema-meta.js";

export { SchemaSerializationError };

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
  "describeConnection",
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

interface ZodCheckNode {
  type?: string;
  check?: string;
  format?: string;
  tx?: unknown;
  fn?: unknown;
  _def?: ZodCheckNode;
  _zod?: {
    def?: ZodCheckNode;
  };
}

interface ZodSchemaNode {
  _def?: {
    type?: string;
    innerType?: ZodSchemaNode;
    checks?: ZodCheckNode[];
  };
  meta?: () => Record<string, unknown> | undefined;
  isOptional?: () => boolean;
}

/**
 * Zod 4.6.5 Version Assumption:
 * Zod 4 implements built-in string `.trim()` via an internal `$ZodCheckOverwrite`
 * check whose transformation function `tx` is the closure `(input) => input.trim()`
 * returned by the internal `_trim()` check factory.
 *
 * Because Zod 4 does not expose a public discriminator or unique trait on overwrite checks,
 * we deterministically verify that an overwrite check is the built-in trim operation by
 * comparing its function source against the canonical `z.trim()` reference implementation,
 * without executing arbitrary schema functions.
 */
const CANONICAL_ZOD_TRIM_SOURCE: string | null = (() => {
  try {
    const canonical = z.trim();
    const tx = (canonical as unknown as { _zod?: { def?: { tx?: unknown } } })
      ._zod?.def?.tx;
    return typeof tx === "function" ? tx.toString() : null;
  } catch {
    return null;
  }
})();

function isBuiltInZodTrimCheck(checkDef: ZodCheckNode | undefined): boolean {
  if (
    checkDef?.check !== "overwrite" ||
    typeof checkDef.tx !== "function" ||
    !CANONICAL_ZOD_TRIM_SOURCE
  ) {
    return false;
  }

  return checkDef.tx.toString() === CANONICAL_ZOD_TRIM_SOURCE;
}

/**
 * Serializes a Zod config schema into a flat array of ProviderConfigFieldDescriptors.
 * Throws SchemaSerializationError if any construct violates the defined subset.
 */
export function serializeProviderConfigSchema(
  schema: unknown,
): ProviderConfigFieldDescriptor[] {
  const fields: ProviderConfigFieldSchema[] = readConfigFieldSchemas(schema);
  const descriptors: ProviderConfigFieldDescriptor[] = [];

  for (const field of fields) {
    descriptors.push(serializeField(field.name, field.schema));
  }

  validateCrossRoleFieldUniqueness(descriptors);
  return descriptors;
}

function serializeField(
  name: string,
  fieldSchema: unknown,
): ProviderConfigFieldDescriptor {
  const { schema, meta, isOptional } = unwrapConfigField(name, fieldSchema);

  validateCoreTypeAndChecks(name, schema as ZodSchemaNode);
  return buildDescriptor(name, meta, isOptional);
}

function validateCoreTypeAndChecks(name: string, cur: ZodSchemaNode) {
  const coreType = cur._def?.type;
  if (coreType !== "string") {
    throw new SchemaSerializationError(
      `Field "${name}" has unsupported type "${coreType}". Provider config schemas only support string fields.`,
    );
  }

  if (cur._def?.type === "pipe") {
    throw new SchemaSerializationError(
      `Field "${name}" contains unsupported pipe or transform. Transforms cannot be serialized.`,
    );
  }

  const checks = cur._def?.checks;
  if (Array.isArray(checks)) {
    for (const check of checks) {
      const checkDef = check._zod?.def ?? check._def ?? check;
      const checkType = checkDef?.check ?? checkDef?.type ?? check?.type;
      const allowedChecks = [
        "min_length",
        "max_length",
        "string_format",
        "overwrite",
      ];

      if (typeof checkType === "string" && !allowedChecks.includes(checkType)) {
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

      if (checkType === "overwrite") {
        if (!isBuiltInZodTrimCheck(checkDef)) {
          throw new SchemaSerializationError(
            `Field "${name}" contains unsupported overwrite refinement. Custom refinements cannot be serialized.`,
          );
        }
      } else if (checkType === "custom" || typeof checkDef?.fn === "function") {
        throw new SchemaSerializationError(
          `Field "${name}" contains unsupported refinement. Custom refinements cannot be serialized.`,
        );
      }
    }
  }
}

function buildDescriptor(
  name: string,
  meta: Record<string, unknown> | undefined,
  isOptional: boolean,
): ProviderConfigFieldDescriptor {
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

  const label = validateLabel(name, meta);
  const uiType = validateUiType(name, meta);
  const isSecret = validateSecret(name, meta, uiType);
  const roles = validateRoles(name, meta);

  validateOptionalStrings(name, meta, "placeholder");
  validateOptionalStrings(name, meta, "help");

  const descriptor: ProviderConfigFieldDescriptor = {
    name,
    label,
    type: uiType,
    required: !isOptional,
  };

  if (isSecret) descriptor.secret = true;
  if (typeof meta.placeholder === "string")
    descriptor.placeholder = meta.placeholder;
  if (typeof meta.help === "string") descriptor.help = meta.help;
  if (roles) descriptor.roles = roles;

  return descriptor;
}

function validateLabel(name: string, meta: Record<string, unknown>): string {
  const label = meta.label as string;
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new SchemaSerializationError(
      `Field "${name}" metadata must provide a non-empty string "label".`,
    );
  }
  return label;
}

function validateUiType(
  name: string,
  meta: Record<string, unknown>,
): ProviderConfigUiType {
  const uiType = meta.uiType as ProviderConfigUiType;
  if (typeof uiType !== "string" || !VALID_UI_TYPES.has(uiType)) {
    throw new SchemaSerializationError(
      `Field "${name}" metadata has invalid uiType: "${uiType}". Allowed: text, secret, url, email.`,
    );
  }
  return uiType;
}

function validateSecret(
  name: string,
  meta: Record<string, unknown>,
  uiType: ProviderConfigUiType,
): boolean {
  const isSecret = meta.secret === true;
  if (isSecret) {
    if (uiType !== "secret") {
      throw new SchemaSerializationError(
        `Field "${name}" has secret: true but uiType is "${uiType}". Secret fields must have uiType "secret".`,
      );
    }
    if (
      typeof meta.envKey !== "string" ||
      (meta.envKey as string).trim().length === 0
    ) {
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
  return isSecret;
}

function validateRoles(
  name: string,
  meta: Record<string, unknown>,
): ProviderRole[] | undefined {
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
    return [...(meta.roles as ProviderRole[])];
  }
  return undefined;
}

function validateOptionalStrings(
  name: string,
  meta: Record<string, unknown>,
  key: string,
) {
  if (key in meta && meta[key] !== undefined && typeof meta[key] !== "string") {
    throw new SchemaSerializationError(
      `Field "${name}" metadata "${key}" must be a string.`,
    );
  }
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
