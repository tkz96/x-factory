import re

with open("test/azure-provider.test.ts", "r") as f:
    content = f.read()

# Fix serializes through the generic serializer gate with zero errors
content = content.replace(
    'expect(patField?.required).toBe(false);',
    'expect(patField?.required).toBe(true);'
)

# Fix validates valid and invalid configurations against azureConfigSchema
content = content.replace(
    """      const validWithoutPat = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
      });
      expect(validWithoutPat.success).toBe(true);""",
    """      const validWithoutPat = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
      });
      expect(validWithoutPat.success).toBe(false);"""
)

# Fix "unexpected properties are preserved (passthrough)" test which should now be rejected
content = content.replace(
    """      const validWithExtra = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
        pat: "test-pat",
        unknownProp: "preserved",
      });
      expect(validWithExtra.success).toBe(true);
      if (validWithExtra.success) {
        expect((validWithExtra.data as any).unknownProp).toBe("preserved");
      }""",
    """      const invalidWithExtra = azureConfigSchema.safeParse({
        orgUrl: "https://dev.azure.com/myorg",
        project: "MyProject",
        pat: "test-pat",
        unknownProp: "rejected",
      });
      // Actually Zod object defaults to strip, not strict.
      // Wait, without passthrough(), unknown props are STRIPPED, they do not cause failure.
      // So success should be true, but it should be stripped!
      expect(invalidWithExtra.success).toBe(true);
      if (invalidWithExtra.success) {
        expect((invalidWithExtra.data as any).unknownProp).toBeUndefined();
      }"""
)

with open("test/azure-provider.test.ts", "w") as f:
    f.write(content)

