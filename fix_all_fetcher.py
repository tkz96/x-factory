import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Replace direct calls to fetcher(...) with getFetcher()(...)
content = re.sub(r'await fetcher\(', r'await getFetcher()(', content)

# But wait, inside azureFetch it should NOT be getFetcher()
content = content.replace('const res = await getFetcher()(url, options);', 'const res = await fetcher(url, options);')

# Also fix the type error for item._links
content = content.replace('let webUrl = links?.web?.href || "";', 'let webUrl = (typeof links?.web?.href === "string") ? links.web.href : "";')
content = content.replace('url: item._links?.html?.href || fallbackUrl,', 'url: ((item._links as any)?.html?.href) || fallbackUrl,')

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

