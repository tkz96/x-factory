import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

replacement = """    async listTickets(
      config: ProviderConfig,
      options: TicketQueryOptions,
    ): Promise<TrackerTicket[]> {
      const parsed = azureConfigSchema.safeParse(config);
      if (!parsed.success) {
        throw new Error(`Invalid Azure configuration: ${parsed.error.message}`);
      }

      const { orgUrl, project, pat } = parsed.data;
      const { cleanOrgUrl, encodedProject, authHeader } = await prepareAzureContext(config, undefined, "Azure DevOps authentication required.");

      const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
      const escapedLabel = label.replace(/'/g, "''");
      const wiqlUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS '${escapedLabel}' AND [System.State] <> 'Closed' AND [System.State] <> 'Done' ORDER BY [System.ChangedDate] DESC`;

      const res = await azureFetch(wiqlUrl, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        fetchFn: fetcher,
      });

      const raw = res.data as any;
      if (!raw || !Array.isArray(raw.workItems) || raw.workItems.length === 0) return [];
      
      const ids = raw.workItems.map((w: any) => w.id).slice(0, 50);
      if (ids.length === 0) return [];

      const itemsUrl = `${cleanOrgUrl}/${encodedProject}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.1`;
      const itemsRes = await azureFetch(itemsUrl, {
        headers: { Authorization: authHeader, Accept: "application/json" },
        fetchFn: fetcher,
      });

      const itemsRaw = itemsRes.data as any;
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

        const fallbackUrl = `${cleanOrgUrl}/${encodeURIComponent(project)}/_workitems/edit/${item.id}`;

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
    },"""

content = re.sub(
    r'    async listTickets\(\n      config: ProviderConfig,\n      options: TicketQueryOptions,\n    \): Promise<TrackerTicket\[\]> \{\n      const parsed = azureConfigSchema\.safeParse\(config\);\n      if \(!parsed\.success\) \{\n        throw new Error\(`Invalid Azure configuration: \$\{parsed\.error\.message\}`\);\n      \}\n\n      const \{ orgUrl, project, pat \} = parsed\.data;\n      return fetchAzureTickets\(\{\n        orgUrl,\n        project,\n        pat,\n        requiredLabel: options\.requiredLabel,\n      \}\);\n    \},',
    replacement,
    content
)

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

