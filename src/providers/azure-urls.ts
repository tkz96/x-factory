// src/providers/azure-urls.ts — Azure DevOps URL parsing (#139, #186).

/**
 * Extract canonical organization name from an Azure DevOps URL.
 */
export function extractOrgNameFromUrl(orgUrl: string): string | null {
  const trimmed = orgUrl.trim().replace(/\/+$/, "");
  // dev.azure.com/<org>
  const devAzureMatch = trimmed.match(
    /^(?:https?:\/\/)?dev\.azure\.com\/([^/]+)/i,
  );
  if (devAzureMatch?.[1]) {
    return decodeURIComponent(devAzureMatch[1]).toLowerCase();
  }
  // <org>.visualstudio.com
  const vsMatch = trimmed.match(/^(?:https?:\/\/)?([^.]+)\.visualstudio\.com/i);
  if (vsMatch?.[1]) {
    return decodeURIComponent(vsMatch[1]).toLowerCase();
  }
  // ssh.dev.azure.com:v3/<org>
  const sshMatch = trimmed.match(/^(?:git@)?ssh\.dev\.azure\.com:v3\/([^/]+)/i);
  if (sshMatch?.[1]) {
    return decodeURIComponent(sshMatch[1]).toLowerCase();
  }
  return null;
}
