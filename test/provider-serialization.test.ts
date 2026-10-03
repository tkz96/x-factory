// test/provider-serialization.test.ts — Unit tests for the generic Zod-to-descriptor serializer.

import { describe, expect, it } from "bun:test";
import { z } from "zod/v4";
import type { ProviderConfigFieldMeta } from "../src/providers/contract.js";
import {
  SchemaSerializationError,
  serializeProvider,
  serializeProviderConfigSchema,
  validateCrossRoleFieldUniqueness,
} from "../src/providers/serializer.js";
import { stubConfigSchema, stubProvider } from "./fixtures/stub-provider.js";

describe("serializeProviderConfigSchema", () => {
  it("serializes valid config schemas cleanly", () => {
    const descriptors = serializeProviderConfigSchema(stubConfigSchema);
    expect(descriptors).toEqual([
      {
        name: "host",
        label: "Host",
        type: "url",
        required: true,
      },
      {
        name: "apiToken",
        label: "API token",
        type: "secret",
        required: true,
        secret: true,
        help: "Stored in per-project environment storage.",
      },
      {
        name: "project",
        label: "Project",
        type: "text",
        required: true,
      },
    ]);
  });

  it("handles optional fields correctly (required: false)", () => {
    const meta: ProviderConfigFieldMeta = {
      label: "Optional note",
      uiType: "text",
    };
    const schema = z.object({
      note: z.string().optional().meta(meta),
    });
    const descriptors = serializeProviderConfigSchema(schema);
    expect(descriptors).toEqual([
      {
        name: "note",
        label: "Optional note",
        type: "text",
        required: false,
      },
    ]);
  });

  it("handles default wrappers correctly", () => {
    const meta: ProviderConfigFieldMeta = {
      label: "Timeout",
      uiType: "text",
    };
    const schema = z.object({
      timeout: z.string().default("30").meta(meta),
    });
    const descriptors = serializeProviderConfigSchema(schema);
    expect(descriptors).toEqual([
      {
        name: "timeout",
        label: "Timeout",
        type: "text",
        required: false,
      },
    ]);
  });

  it("fails loudly if root schema is not a ZodObject", () => {
    expect(() =>
      serializeProviderConfigSchema(
        z.string() as unknown as z.ZodObject<never>,
      ),
    ).toThrow(SchemaSerializationError);
    expect(() =>
      serializeProviderConfigSchema(
        z.array(z.string()) as unknown as z.ZodObject<never>,
      ),
    ).toThrow(SchemaSerializationError);
    expect(() =>
      serializeProviderConfigSchema(null as unknown as z.ZodObject<never>),
    ).toThrow(SchemaSerializationError);
  });

  it("fails loudly on non-string field types", () => {
    const schemaWithNumber = z.object({
      port: z
        .number()
        .meta({ label: "Port", uiType: "text" } as ProviderConfigFieldMeta),
    });
    expect(() => serializeProviderConfigSchema(schemaWithNumber)).toThrow(
      /unsupported type "number"/,
    );

    const schemaWithBoolean = z.object({
      enabled: z
        .boolean()
        .meta({ label: "Enabled", uiType: "text" } as ProviderConfigFieldMeta),
    });
    expect(() => serializeProviderConfigSchema(schemaWithBoolean)).toThrow(
      /unsupported type "boolean"/,
    );
  });

  it("fails loudly if field is missing metadata", () => {
    const schema = z.object({
      missingMeta: z.string(),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /missing metadata/,
    );
  });

  it("fails loudly if metadata duplicates schema-derived property 'required'", () => {
    const schema = z.object({
      field: z.string().meta({
        label: "Field",
        uiType: "text",
        required: true,
      } as unknown as ProviderConfigFieldMeta),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /duplicates schema-derived property "required"/,
    );
  });

  it("fails loudly on empty or missing label in metadata", () => {
    const schemaNoLabel = z.object({
      field: z
        .string()
        .meta({ label: "", uiType: "text" } as ProviderConfigFieldMeta),
    });
    expect(() => serializeProviderConfigSchema(schemaNoLabel)).toThrow(
      /non-empty string "label"/,
    );
  });

  it("fails loudly on invalid uiType", () => {
    const schema = z.object({
      field: z.string().meta({
        label: "Field",
        uiType: "invalidType" as unknown as ProviderConfigFieldMeta["uiType"],
      }),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /invalid uiType/,
    );
  });

  it("fails loudly on secret field missing envKey", () => {
    const schema = z.object({
      secretField: z.string().meta({
        label: "Secret",
        uiType: "secret",
        secret: true,
      }),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /missing "envKey"/,
    );
  });

  it("fails loudly on secret field with non-secret uiType", () => {
    const schema = z.object({
      secretField: z.string().meta({
        label: "Secret",
        uiType: "text",
        secret: true,
        envKey: "MY_SECRET",
      }),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /has secret: true but uiType is "text"/,
    );
  });

  it("fails loudly on non-secret field declaring envKey", () => {
    const schema = z.object({
      host: z.string().meta({
        label: "Host",
        uiType: "url",
        envKey: "LEAKED_ENV_KEY",
      }),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /Non-secret field "host" must not declare "envKey"/,
    );
  });

  it("fails loudly on unsupported refinements or transforms", () => {
    const schemaWithRefine = z.object({
      custom: z
        .string()
        .refine((v) => v.length > 5)
        .meta({ label: "Custom", uiType: "text" }),
    });
    expect(() => serializeProviderConfigSchema(schemaWithRefine)).toThrow(
      /unsupported check "custom"/,
    );

    const schemaWithTransform = z.object({
      transformed: z
        .string()
        .transform((v) => v.trim())
        .meta({ label: "Trimmed", uiType: "text" }),
    });
    expect(() => serializeProviderConfigSchema(schemaWithTransform)).toThrow(
      /unsupported type "pipe"|unsupported pipe or transform/,
    );

    const schemaWithRegex = z.object({
      regexField: z
        .string()
        .regex(/^[a-z]+$/)
        .meta({ label: "Regex", uiType: "text" }),
    });
    expect(() => serializeProviderConfigSchema(schemaWithRegex)).toThrow(
      /unsupported string format "regex"/,
    );
  });

  it("fails loudly on unknown metadata properties", () => {
    const schema = z.object({
      field: z.string().meta({
        label: "Field",
        uiType: "text",
        unknownProp: "bogus",
      } as unknown as ProviderConfigFieldMeta),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /unknown metadata property "unknownProp"/,
    );
  });

  it("fails loudly on invalid roles in metadata", () => {
    const schema = z.object({
      field: z.string().meta({
        label: "Field",
        uiType: "text",
        roles: ["invalidRole" as unknown as "tracker"],
      }),
    });
    expect(() => serializeProviderConfigSchema(schema)).toThrow(
      /invalid role "invalidRole"/,
    );
  });
});

describe("validateCrossRoleFieldUniqueness", () => {
  it("passes when all field names are unique", () => {
    expect(() =>
      validateCrossRoleFieldUniqueness([
        { name: "host", label: "Host", type: "url", required: true },
        { name: "token", label: "Token", type: "secret", required: true },
      ]),
    ).not.toThrow();
  });

  it("throws SchemaSerializationError on duplicate field names", () => {
    expect(() =>
      validateCrossRoleFieldUniqueness([
        { name: "host", label: "Host", type: "url", required: true },
        { name: "host", label: "Duplicate Host", type: "text", required: true },
      ]),
    ).toThrow(
      /Cross-role field-name uniqueness violation: Duplicate field name "host"/,
    );
  });
});

describe("serializeProvider", () => {
  it("serializes provider and includes capabilities", () => {
    const descriptor = serializeProvider(stubProvider);
    expect(descriptor).not.toBeNull();
    expect(descriptor?.id).toBe("stub");
    expect(descriptor?.displayName).toBe("Stub Provider");
    expect(descriptor?.roles).toEqual(["tracker", "gitHost"]);
    expect(descriptor?.capabilities).toEqual(["verifyScopes", "parseQuickUrl"]);
    expect(descriptor?.configFields.length).toBe(3);
  });

  it("filters provider by role", () => {
    const trackerDescriptor = serializeProvider(stubProvider, "tracker");
    expect(trackerDescriptor).not.toBeNull();

    // Stub has roles: ["tracker", "gitHost"]
    const nonExistentRoleDescriptor = serializeProvider(
      { ...stubProvider, roles: ["tracker"] },
      "gitHost",
    );
    expect(nonExistentRoleDescriptor).toBeNull();
  });
});
