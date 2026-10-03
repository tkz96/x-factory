import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

replacement = """  // 1. Semantic Status Classification (Highest Precedence)
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

  if (lowerMsg.includes("not found")) {
    return { code: "NOT_FOUND", context };
  }"""

content = re.sub(
    r'  if \(\n    status === 429 \|\|[\s\S]*?if \(status === 404 \|\| message\.toLowerCase\(\)\.includes\("not found"\)\) \{\n    return \{\n      code: "NOT_FOUND",\n      context,\n    \};\n  \}',
    replacement,
    content
)

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

