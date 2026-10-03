import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Replace:
# const fetcher = deps.fetchFn || globalThis.fetch;
# with:
# const getFetcher = () => deps.fetchFn || globalThis.fetch;
content = content.replace(
    'const fetcher = deps.fetchFn || globalThis.fetch;',
    'const getFetcher = () => deps.fetchFn || globalThis.fetch;'
)

# Replace fetchFn: fetcher with fetchFn: getFetcher()
content = content.replace('fetchFn: fetcher', 'fetchFn: getFetcher()')

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

