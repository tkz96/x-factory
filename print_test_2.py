with open("test/provider-contract.test.ts", "r") as f:
    lines = f.readlines()
for i in range(105, 114):
    print(repr(lines[i]))
