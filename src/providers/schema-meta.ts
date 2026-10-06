// src/providers/schema-meta.ts — Shared, provider-agnostic view over a
// provider's zod config schema.
//
// Two consumers read the same registered schema and must never disagree about
// what it declares:
// - `serializer.ts` builds the client-facing field descriptors and strips
//   `envKey` from them (it must never cross the HTTP boundary).
// - `secret-routing.ts` derives the secret fields and their `envKey` targets
//   on the server side only.
// The shape walk and the field-metadata read live here once.

/**
 * Typed error thrown when a schema violates the supported serialization
 * subset. Defined here (next to the schema walk) and re-exported by the
 * serializer, which is the module that owns the subset's semantics.
 */
export class SchemaSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaSerializationError";
  }
}

interface SchemaNode {
  _def?: {
    type?: string;
    innerType?: unknown;
  };
  meta?: () => Record<string, unknown> | undefined;
  isOptional?: () => boolean;
}

/** One declared field of a provider config schema, before interpretation. */
export interface ProviderConfigFieldSchema {
  name: string;
  schema: unknown;
}

/**
 * Reads the declared fields of a provider's zod config schema.
 * Throws SchemaSerializationError when the schema is not a ZodObject.
 */
export function readConfigFieldSchemas(
  schema: unknown,
): ProviderConfigFieldSchema[] {
  if (
    !schema ||
    typeof schema !== "object" ||
    !("_def" in schema) ||
    (schema as SchemaNode)._def?.type !== "object"
  ) {
    throw new SchemaSerializationError(
      "Provider config schema must be a ZodObject.",
    );
  }

  const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;
  return Object.entries(shape).map(([name, fieldSchema]) => ({
    name,
    schema: fieldSchema,
  }));
}

/** A config field schema after optional/default unwrapping. */
export interface UnwrappedConfigField {
  /** The core field schema (wrappers removed). */
  schema: unknown;
  /** Metadata declared via `.meta(...)`, if any. */
  meta: Record<string, unknown> | undefined;
  isOptional: boolean;
}

/**
 * Unwraps a config field schema down to its core schema, collecting the
 * metadata and requiredness declared on the way. Only `optional` and `default`
 * wrappers are part of the supported subset; anything else fails loudly.
 */
export function unwrapConfigField(
  name: string,
  fieldSchema: unknown,
): UnwrappedConfigField {
  if (
    !fieldSchema ||
    typeof fieldSchema !== "object" ||
    !("_def" in fieldSchema)
  ) {
    throw new SchemaSerializationError(
      `Field "${name}" is not a valid Zod schema.`,
    );
  }

  let cur = fieldSchema as SchemaNode;
  let isOptional = false;
  let meta: Record<string, unknown> | undefined =
    typeof cur.meta === "function" ? cur.meta() : undefined;

  if (typeof cur.isOptional === "function" && cur.isOptional()) {
    isOptional = true;
  }

  while (cur._def?.innerType) {
    const defType = cur._def?.type;
    if (defType !== "optional" && defType !== "default") {
      throw new SchemaSerializationError(
        `Field "${name}" has unsupported wrapper type "${defType}". Only optional and default wrappers are supported.`,
      );
    }
    if (defType === "optional") {
      isOptional = true;
    }
    cur = cur._def.innerType as SchemaNode;
    if (!meta && typeof cur.meta === "function") {
      meta = cur.meta();
    }
  }

  return { schema: cur, meta, isOptional };
}
