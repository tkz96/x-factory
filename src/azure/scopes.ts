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

type Fetcher = typeof fetch;

async function probeWorkItemsRead(
  fetcher: Fetcher,
  orgUrl: string,
  encodedProject: string,
  authHeader: string,
): Promise<boolean> {
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
    if (res.status === 200) return true;
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    return false;
  }
}

async function probeCodeRead(
  fetcher: Fetcher,
  orgUrl: string,
  encodedProject: string,
  authHeader: string,
): Promise<{ codeRead: boolean; firstRepoIdOrName?: string | undefined }> {
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
      let firstRepoIdOrName: string | undefined;
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
      return { codeRead: true, firstRepoIdOrName };
    }
    return { codeRead: false };
  } catch {
    return { codeRead: false };
  }
}

async function probeCodeStatus(
  fetcher: Fetcher,
  orgUrl: string,
  encodedProject: string,
  targetRepo: string,
  authHeader: string,
): Promise<boolean> {
  try {
    const statusUrl = `${orgUrl}/${encodedProject}/_apis/git/repositories/${encodeURIComponent(targetRepo)}/commits/0000000000000000000000000000000000000000/statuses?api-version=7.1`;
    const res = await fetcher(statusUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (res.status === 200 || res.status === 404) return true;
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    return false;
  }
}

async function probeWorkItemsWrite(
  fetcher: Fetcher,
  orgUrl: string,
  authHeader: string,
): Promise<boolean> {
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
    return res.status === 404 || res.status === 200;
  } catch {
    return false;
  }
}

async function probeCodeFull(
  fetcher: Fetcher,
  orgUrl: string,
  encodedProject: string,
  authHeader: string,
): Promise<boolean> {
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
    return res.status === 200;
  } catch {
    return false;
  }
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

  const workItemsRead = await probeWorkItemsRead(
    fetcher,
    orgUrl,
    encodedProject,
    authHeader,
  );
  const { codeRead, firstRepoIdOrName } = await probeCodeRead(
    fetcher,
    orgUrl,
    encodedProject,
    authHeader,
  );
  const codeStatus = await probeCodeStatus(
    fetcher,
    orgUrl,
    encodedProject,
    firstRepoIdOrName || project,
    authHeader,
  );
  const workItemsWriteDetected = await probeWorkItemsWrite(
    fetcher,
    orgUrl,
    authHeader,
  );
  const codeFullDetected = await probeCodeFull(
    fetcher,
    orgUrl,
    encodedProject,
    authHeader,
  );

  scopes.workItemsRead = workItemsRead;
  scopes.codeRead = codeRead;
  scopes.codeStatus = codeStatus;
  scopes.workItemsWriteDetected = workItemsWriteDetected;
  scopes.codeFullDetected = codeFullDetected;

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
