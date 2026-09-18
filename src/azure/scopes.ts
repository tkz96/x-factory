// src/azure/scopes.ts — Live Azure DevOps Personal Access Token (PAT) scope diagnostic prober.

import { extractAzureDevOpsInfo } from "../discovery/azure.js";
import { formatAzureAuthHeader, resolveAzureAuthHeader } from "./auth.js";

export interface AzureScopeDiagnosticResult {
  ok: boolean;
  overPrivileged: boolean;
  scopes: {
    workItemsRead: boolean;
    codeRead: boolean;
    codeStatus: boolean;
    workItemsWriteDetected: boolean;
    codeFullDetected: boolean;
  };
  errors: string[];
  warnings: string[];
}

export interface TestAzurePatScopesOptions {
  orgUrl?: string | undefined;
  project?: string | undefined;
  pat?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

/**
 * Perform live least-privilege scope diagnostics against Azure DevOps REST APIs.
 *
 * Verifies minimum required scopes:
 * - Work Items: Read (Query wiql)
 * - Code: Read (List git repositories)
 * - Code: Status (Commit status API check)
 *
 * Checks for potential over-privileging (warning + user ack):
 * - Work Items: Write
 * - Code: Full
 */
export async function testAzurePatScopes(
  options: TestAzurePatScopesOptions,
): Promise<AzureScopeDiagnosticResult> {
  const fetcher = options.fetchFn || globalThis.fetch;
  const parsed = extractAzureDevOpsInfo(options.project || options.orgUrl);
  const orgUrl = (options.orgUrl || parsed.orgUrl || "")
    .trim()
    .replace(/\/+$/, "");
  const project = (parsed.project || options.project || "").trim();

  const errors: string[] = [];
  const warnings: string[] = [];
  const scopes = {
    workItemsRead: false,
    codeRead: false,
    codeStatus: false,
    workItemsWriteDetected: false,
    codeFullDetected: false,
  };

  if (!orgUrl || !project) {
    return {
      ok: false,
      overPrivileged: false,
      scopes,
      errors: [
        "Organization URL and Project Name are required for scope validation.",
      ],
      warnings,
    };
  }

  let authHeader = "";
  if (options.pat?.trim()) {
    authHeader = formatAzureAuthHeader(options.pat);
  } else {
    authHeader = await resolveAzureAuthHeader();
  }

  if (!authHeader) {
    return {
      ok: false,
      overPrivileged: false,
      scopes,
      errors: [
        "Authentication required. Enter an Azure PAT or sign in with Azure CLI.",
      ],
      warnings,
    };
  }

  const encodedProject = encodeURIComponent(project);

  // Probe 1: Work Items (Read) — Required
  try {
    const wiqlUrl = `${orgUrl}/${encodedProject}/_apis/wit/wiql?api-version=7.1`;
    const res = await fetcher(wiqlUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.Id] DESC`,
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (res.status === 200) {
      scopes.workItemsRead = true;
    } else if (res.status === 401 || res.status === 403) {
      scopes.workItemsRead = false;
    } else {
      scopes.workItemsRead = res.ok;
    }
  } catch {
    scopes.workItemsRead = false;
  }

  // Probe 2: Code (Read) — Required
  let firstRepoIdOrName = "";
  try {
    const reposUrl = `${orgUrl}/${encodedProject}/_apis/git/repositories?api-version=7.1`;
    const res = await fetcher(reposUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });
    if (res.status === 200) {
      scopes.codeRead = true;
      try {
        const data = (await res.json()) as {
          value?: Array<{ id: string; name: string }>;
        };
        const first = data.value?.[0];
        if (first) {
          firstRepoIdOrName = first.id || first.name;
        }
      } catch {
        // ignore json parse error
      }
    } else if (res.status === 401 || res.status === 403) {
      scopes.codeRead = false;
    }
  } catch {
    scopes.codeRead = false;
  }

  // Probe 3: Code (Status) — Required
  try {
    const targetRepo = firstRepoIdOrName || project;
    const statusUrl = `${orgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(targetRepo)}/commits/0000000000000000000000000000000000000000/statuses?api-version=7.1`;
    const res = await fetcher(statusUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (res.status === 200 || res.status === 404) {
      scopes.codeStatus = true;
    } else if (res.status === 401 || res.status === 403) {
      scopes.codeStatus = false;
    } else {
      scopes.codeStatus = res.ok;
    }
  } catch {
    scopes.codeStatus = false;
  }

  // Probe 4: Over-privilege check for Work Items: Write
  try {
    const writeProbeUrl = `${orgUrl}/_apis/wit/workitems/-1?api-version=7.1`;
    const res = await fetcher(writeProbeUrl, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json-patch+json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        {
          op: "add",
          path: "/fields/System.Title",
          value: "x-factory-scope-probe",
        },
      ]),
      signal: AbortSignal.timeout(4500),
    });

    // 404 means write authorization passed, but work item -1 was not found!
    scopes.workItemsWriteDetected = res.status === 404 || res.status === 200;
  } catch {
    scopes.workItemsWriteDetected = false;
  }

  // Probe 5: Over-privilege check for Code: Full (vso.code_manage)
  try {
    const binUrl = `${orgUrl}/${encodedProject}/_apis/git/recycleBin/repositories?api-version=7.1`;
    const res = await fetcher(binUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });

    // 200 OK means user has repository administration/manage permissions (Code: Full)
    scopes.codeFullDetected = res.status === 200;
  } catch {
    scopes.codeFullDetected = false;
  }

  // Minimum required scope validations
  if (!scopes.workItemsRead) {
    errors.push(
      "Missing required scope: Work Items (Read). Required to query backlog items and tickets.",
    );
  }
  if (!scopes.codeRead) {
    errors.push(
      "Missing required scope: Code (Read). Required to clone repositories and discover branches.",
    );
  }
  if (!scopes.codeStatus) {
    errors.push(
      "Missing required scope: Code (Status). Required to publish CI verification badges and pipeline check statuses.",
    );
  }

  // Over-privilege notices (user responsibility warnings)
  if (scopes.workItemsWriteDetected) {
    warnings.push(
      "Notice: Work Items (Write) detected. X-Factory only requires Work Items: Read.",
    );
  }
  if (scopes.codeFullDetected) {
    warnings.push(
      "Notice: Code (Full) detected. X-Factory only requires Code: Read & write.",
    );
  }

  const overPrivileged = Boolean(
    scopes.workItemsWriteDetected || scopes.codeFullDetected,
  );
  const ok = scopes.workItemsRead && scopes.codeRead && scopes.codeStatus;

  return {
    ok,
    overPrivileged,
    scopes,
    errors,
    warnings,
  };
}
