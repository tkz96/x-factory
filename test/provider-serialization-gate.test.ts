// test/provider-serialization-gate.test.ts — Registry-level serialization gate.
//
// Wayfinder #127 acceptance gate:
// Runs the generic Zod-to-descriptor serializer over every provider registered
// in the static registry (and the stub provider). A malformed or unsupported
// schema construct fails CI here, never at runtime in production.

import { describe, expect, it } from "bun:test";
import { listProviders } from "../src/providers/registry.js";
import {
  serializeProvider,
  serializeProviderConfigSchema,
} from "../src/providers/serializer.js";
import { stubProvider } from "./fixtures/stub-provider.js";

describe("registry-level serialization gate", () => {
  it("serializes the stub provider with zero errors", () => {
    const descriptor = serializeProvider(stubProvider);
    expect(descriptor).not.toBeNull();
    expect(descriptor?.id).toBe("stub");
    expect(descriptor?.configFields.length).toBeGreaterThan(0);

    for (const field of descriptor?.configFields ?? []) {
      expect(field.name).toBeTruthy();
      expect(field.label).toBeTruthy();
      expect(["text", "secret", "url", "email"]).toContain(field.type);
      expect(typeof field.required).toBe("boolean");
      // Critical security invariant: envKey must NEVER be present
      expect(field).not.toHaveProperty("envKey");
    }
  });

  it("serializes every provider registered in the static registry cleanly", () => {
    const registered = listProviders();
    // Built-ins will land in #138, #139, #140. When they do, this loop gates them.
    for (const provider of registered) {
      const descriptor = serializeProvider(provider);
      expect(descriptor).not.toBeNull();
      expect(descriptor?.id).toBe(provider.id);
      expect(descriptor?.displayName).toBe(provider.displayName);

      const fieldDescriptors = serializeProviderConfigSchema(
        provider.configSchema,
      );
      for (const field of fieldDescriptors) {
        expect(field.name).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(["text", "secret", "url", "email"]).toContain(field.type);
        expect(typeof field.required).toBe("boolean");
        // Critical security invariant: envKey must NEVER be present
        expect(field).not.toHaveProperty("envKey");
      }
    }
  });

  it("verifies the gate catches and fails loudly on an invalid registered provider schema", () => {
    const badProvider = {
      ...stubProvider,
      id: "bad",
      configSchema: {
        _def: { type: "string" },
      } as unknown as typeof stubProvider.configSchema,
    };

    expect(() => serializeProvider(badProvider)).toThrow(
      /Provider config schema must be a ZodObject/,
    );
  });
});
