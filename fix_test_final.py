with open("test/provider-contract.test.ts", "r") as f:
    content = f.read()

content = content.replace("  getProvider,\n", "")
content = content.replace("  listProviders,\n", "")
content = content.replace("  PROVIDER_REGISTRY,\n", "")

to_remove = """  test("is empty during prefactoring; real providers land in their own tickets", () => {
    // Adding a provider = one new directory + one BUILT_INS entry (#138–#140).
    expect(listProviders()).toEqual([]);
    expect(getProvider("github")).toBeUndefined();
    expect(PROVIDER_REGISTRY.size).toBe(0);
  });

"""
content = content.replace(to_remove, "")

with open("test/provider-contract.test.ts", "w") as f:
    f.write(content)

