import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Remove legacy imports
content = re.sub(
    r'import \{\s*type CliCommandExecutor,\s*formatAzureAuthHeader,\s*getAzureCliAuthHeader,\s*\} from "../azure/auth\.js";',
    'export type CliCommandExecutor = (\n  cmd: string,\n  args: string[],\n  options?: { timeoutMs?: number }\n) => Promise<{ passed: boolean; stdout: string }>;',
    content
)
content = re.sub(r'import \{ normalizeGitRef \} from "../azure/pr\.js";\n', '', content)
content = re.sub(r'import \{ fetchAzureTickets \} from "../trackers/azure\.js";\n', '', content)
content = re.sub(r'import type \{ TrackerTicket \} from "../trackers/index\.js";\n', '', content)
content = re.sub(r'type VerificationWarning,\n\} from "\./contract\.js";', 'type VerificationWarning,\n  type TrackerTicket,\n} from "./contract.js";', content)

# 4. Remove .passthrough() and fix PAT schema
content = content.replace('.passthrough();', ';')
content = content.replace(
    'pat: z.string().optional().meta({',
    'pat: z.string().min(1).meta({'
)
content = content.replace(
    'help: "Personal Access Token with Code and Work Items scopes (optional if logged in via Azure CLI)",',
    'help: "Personal Access Token with Code and Work Items scopes.",'
)
content = content.replace(
    'authErrorMessage = "Authentication required. Enter an Azure PAT or sign in with Azure CLI.",',
    'authErrorMessage = "Authentication required.",'
)

# Fix toUserError classification
to_user_error_fixed = """
  let status: number | undefined;
  let message = "";
  let isHtml = false;
  let isRateLimit = false;
  let retryAfterMs: number | undefined;

  if (raw instanceof AzureApiError) {
    status = raw.status;
    message = raw.message;
    isHtml = raw.isHtml ?? false;
    isRateLimit = raw.isRateLimit ?? false;
    retryAfterMs = raw.retryAfterMs;
  } else if (raw instanceof Error) {
    message = raw.message;
    if (
      "status" in raw &&
      typeof (raw as Record<string, unknown>).status === "number"
    ) {
      status = (raw as Record<string, unknown>).status as number;
    }
  } else if (typeof raw === "string") {
    message = raw;
  }

  // 1. Semantic Status Classification (Highest Precedence)
  if (status === 401 || status === 203 || isHtml) {
    return { code: "AUTH_INVALID", context };
  }
  if (status === 403) {
    return { code: "PERMISSION", context };
  }
  if (status === 404) {
    return { code: "NOT_FOUND", context };
  }
  if (status === 429 || isRateLimit) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0 ? { retryAfterMs } : {}),
    };
  }

  // 2. Message Heuristics Fallback
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("tf400733") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("too many requests")
  ) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0 ? { retryAfterMs } : {}),
    };
  }

  if (
    lowerMsg.includes("auth") ||
    lowerMsg.includes("token") ||
    lowerMsg.includes("pat") ||
    lowerMsg.includes("sign-in") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("html response")
  ) {
    return { code: "AUTH_INVALID", context };
  }

  if (
    lowerMsg.includes("forbidden") ||
    lowerMsg.includes("permission") ||
    lowerMsg.includes("tf401027")
  ) {
    return { code: "PERMISSION", context };
  }

  return { code: "UNKNOWN", context };
"""
content = re.sub(
    r'  let status: number \| undefined;.*return \{ code: "UNKNOWN", context \};\n',
    to_user_error_fixed,
    content,
    flags=re.DOTALL
)

# Write back
with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

