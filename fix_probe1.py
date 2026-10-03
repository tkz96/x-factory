import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

replacement = """      // 4. Probe 1: Repositories read (authoritative check for project & repos)
      let repos: Array<{ id: string; name: string }> = [];
      const reposUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
      
      try {
        const reposRes = await azureFetch(reposUrl, {
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          fetchFn: fetcher,
          signal: AbortSignal.timeout(6000),
        });

        const reposPayload = reposRes.data as { value?: unknown[] } | null | undefined;
        if (Array.isArray(reposPayload?.value)) {
          repos = reposPayload.value.map((r: unknown) => {
            const item = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
            return {
              id: String(item.id ?? ""),
              name: String(item.name ?? ""),
            };
          });
        }
      } catch (err) {
        if (err instanceof AzureApiError && (err.status === 401 || err.isHtml)) {
          throw err;
        }
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "listRepositories",
        });
      }"""

content = re.sub(
    r'      // 4\. Probe 1: Repositories read \(authoritative check for project & repos\)\n      let repos: Array<\{ id: string; name: string \}> = \[\];\n      const reposUrl = `\$\{cleanOrgUrl\}/\$\{encodedProject\}/_apis/git/repositories\?api-version=7\.1`;\n      const reposRes = await azureFetch\(reposUrl, \{\n        headers: \{\n          Authorization: authHeader,\n          Accept: "application/json",\n        \},\n        fetchFn: fetcher,\n        signal: AbortSignal\.timeout\(6000\),\n      \}\);\n\n      const reposPayload = reposRes\.data as\n        \| \{ value\?: unknown\[\] \}\n        \| null\n        \| undefined;\n      if \(Array\.isArray\(reposPayload\?\.value\)\) \{\n        repos = reposPayload\.value\.map\(\(r: unknown\) => \{\n          const item = \(r && typeof r === "object" \? r : \{\}\) as Record<\n            string,\n            unknown\n          >;\n          return \{\n            id: String\(item\.id \?\? ""\),\n            name: String\(item\.name \?\? ""\),\n          \};\n        \}\);\n      \}',
    replacement,
    content
)

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

