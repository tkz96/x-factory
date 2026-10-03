import re

with open("test/provider-contract.test.ts", "r") as f:
    content = f.read()

content = re.sub(r'  test\("is empty during prefactoring; real providers land in their own tickets", \(\) => \{\n    // Adding a provider = one new directory \+ one BUILT_INS entry \(#138–#140\)\.\n    expect\(listProviders\(\)\)\.toEqual\(\[\]\);\n    expect\(PROVIDER_REGISTRY\.size\)\.toBe\(0\);\n  \}\);\n\n', '', content)

with open("test/provider-contract.test.ts", "w") as f:
    f.write(content)

