import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Fix verifyCredentials Probe 1 (repository probe) throwing on 403
# The current code:
#      let repos: Array<{ id: string; name: string }> = [];
#      const reposUrl = `${cleanOrgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
#      const reposRes = await azureFetch(reposUrl, {
#        headers: {
#          Authorization: authHeader,
#          Accept: "application/json",
#        },
#        fetchFn: fetcher,
#        signal: AbortSignal.timeout(6000),
#      });
#      const reposPayload = reposRes.data as ...

fix_probe1 = """
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

        const reposPayload = reposRes.data as
          | { value?: unknown[] }
          | null
          | undefined;
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
      }
"""

content = re.sub(
    r'      let repos: Array<\{ id: string; name: string \}> = \[\];\n      const reposUrl = `\$\{cleanOrgUrl\}/\$\{encodedProject\}/_apis/git/repositories\?api-version=7\.1`;\n.*?      \}',
    fix_probe1.strip('\n'),
    content,
    flags=re.DOTALL,
    count=1
)


# Inline listTickets
inline_list_tickets = """
    async listTickets(
      config: ProviderConfig,
      options: TicketQueryOptions,
    ): Promise<TrackerTicket[]> {
      const parsed = azureConfigSchema.safeParse(config);
      if (!parsed.success) {
        throw new Error(`Invalid Azure configuration: ${parsed.error.message}`);
      }
      const { orgUrl, project, pat } = parsed.data;
      const cleanOrgUrl = orgUrl.trim().replace(/\/+$/, "");
      const encodedProject = encodeURIComponent(project);
      
      const authHeader = await resolveAzureAuthHeader(pat, executor);
      if (!authHeader) {
        throw new Error("Azure DevOps authentication required.");
      }

      const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
      const wiqlUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
      const escapedLabel = label.replace(/'/g, "''");
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS '${escapedLabel}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC`;

      const res = await fetcher(wiqlUrl, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        throw new AzureApiError(`Azure DevOps WIQL error ${res.status}: ${await res.text()}`, { status: res.status, headers: res.headers });
      }
      const raw = await res.json() as any;
      if (!raw || !Array.isArray(raw.workItems)) return [];
      
      const ids = raw.workItems.map((w: any) => w.id).slice(0, 50);
      if (ids.length === 0) return [];

      const itemsUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.1`;
      const itemsRes = await fetcher(itemsUrl, {
        headers: { Authorization: authHeader },
      });

      if (!itemsRes.ok) {
        throw new AzureApiError(`Azure DevOps WorkItems error ${itemsRes.status}: ${await itemsRes.text()}`, { status: itemsRes.status, headers: itemsRes.headers });
      }

      const itemsRaw = await itemsRes.json() as any;
      const items = Array.isArray(itemsRaw?.value) ? itemsRaw.value : [];
      
      return items.map((item: any) => {
        const fields = item.fields || {};
        const title = String(fields["System.Title"] || "");
        const rawDesc = String(fields["System.Description"] || "");
        const rawCriteria = String(fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "");
        const desc = stripHtml(rawDesc);
        const criteriaText = rawCriteria ? stripHtml(rawCriteria) : desc;
        let criteria = extractCriteria(criteriaText);
        if (criteria.length === 0 && rawCriteria) {
          const stripped = stripHtml(rawCriteria).trim();
          if (stripped) {
            criteria = stripped.split(/\\r?\\n/).map((s: string) => s.trim()).filter(Boolean);
          }
        }
        const tags = String(fields["System.Tags"] || "")
          .split(";")
          .map((s: string) => s.trim())
          .filter(Boolean);

        const fallbackUrl = `${cleanOrgUrl}/${encodedProject}/_workitems/edit/${item.id}`;

        return {
          id: `AZ-${item.id}`,
          title,
          description: desc,
          acceptanceCriteria: criteria,
          labels: tags,
          url: item._links?.html?.href || fallbackUrl,
          provider: "azure" as const,
        };
      });
    },
"""

content = re.sub(
    r'    async listTickets\([\s\S]*?\}\),',
    inline_list_tickets.strip('\n'),
    content
)

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

