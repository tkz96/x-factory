// src/shared/failure-reason.ts — The structured reason behind a failed run (#256).
//
// A run that ends in `failed` records why, in words an operator can act on: a category, a
// plain-language message and the recovery the UI can suggest. The raw error text stays on the
// status event's `text`, so this module never has to guess at diagnostic detail.
//
// A stage that can name its failure exactly (a model the provider does not offer, a used-up
// quota) hands the stage runner its own FailureReason; this module is the fallback that
// reads the category out of the error text.

/** What kind of failure ended the run. */
export type FailureCategory =
  | "model"
  | "sandbox"
  | "timeout"
  | "verification"
  | "review"
  | "git"
  | "project"
  | "operator"
  | "unknown";

export interface FailureReason {
  category: FailureCategory;
  /**
   * One sentence for an operator. Never the raw error text — but for a git
   * failure it ends with the underlying error on one line, stripped of
   * credentials and tokens (see `gitErrorDetail`).
   */
  message: string;
  /** What the operator can do about it. */
  recovery: string;
}

/** Ordered: the first pattern that matches decides the category. */
const CATEGORY_PATTERNS: ReadonlyArray<{
  category: Exclude<FailureCategory, "unknown">;
  pattern: RegExp;
}> = [
  // A missing sandbox stops the loop before any model call, so it is read first.
  { category: "sandbox", pattern: /sbx|sandbox/i },
  {
    category: "model",
    pattern:
      /model|api key|key rejected|unauthor|credential|provider|\b(401|403|429)\b|rate limit/i,
  },
  { category: "timeout", pattern: /timed out|timeout/i },
  { category: "verification", pattern: /verification/i },
  { category: "review", pattern: /review/i },
  {
    category: "git",
    pattern: /git|branch|worktree|pull request|commit|push|remote/i,
  },
  { category: "project", pattern: /project/i },
];

const CATEGORY_COPY: Record<
  Exclude<FailureCategory, "unknown">,
  { message: string; recovery: string }
> = {
  model: {
    message: "The model call failed.",
    recovery:
      "Read the provider's reason in the run log, check the model and its connection in Settings › Models, then restart the run.",
  },
  sandbox: {
    message: "The coding agent could not start because the sandbox is missing.",
    recovery:
      "Install the sbx sandbox CLI, or allow running without a sandbox in Settings.",
  },
  timeout: {
    message: "The coding agent ran out of time.",
    recovery:
      "Restart the run; if it runs out of time again, split the ticket into smaller steps.",
  },
  verification: {
    message: "The change did not pass deterministic verification.",
    recovery:
      "Read the failing tests or checks, fix the code or the plan, then restart the run.",
  },
  review: {
    message: "The reviewer did not approve the change.",
    recovery: "Address the review findings, then restart the run.",
  },
  git: {
    message: "A git or pull-request operation failed.",
    recovery:
      "Check the repository path, access and branch state, then restart the run.",
  },
  project: {
    message: "The run's project is not configured correctly.",
    recovery:
      "Fix the project's configuration, path or commands, then restart the run.",
  },
  operator: {
    message: "An operator ended the run.",
    recovery: "Start a new run when you are ready.",
  },
};

/** The reason recorded when an operator abandons a run. */
export const OPERATOR_ABANDON_REASON: FailureReason = {
  category: "operator",
  ...CATEGORY_COPY.operator,
};

/** Credentials inside a URL: `scheme://user:password@host` becomes `scheme://host`. */
const URL_CREDENTIALS = /(?<=\/\/)[^/@\s]+:[^/@\s]+@/g;

/** Things that look like secrets, wherever they appear in a message. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:token|access_token|private_token|api_key|apikey)=)[^\s&]+/gi,
];

/** The "<command> failed (exit N):" header `execStrict` puts on a message's first line. */
const EXIT_HEADER = /^\S.*\(exit \d+\):$/;

/**
 * The git or pull-request error behind a failure, on one line and safe to show
 * an operator: the line that names the failure (not the command header), with
 * URL credentials, tokens and quotes stripped, capped so it stays one line.
 */
function gitErrorDetail(error: string): string | undefined {
  const lines = error
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.find(
    (line) => !EXIT_HEADER.test(line) && /fatal:|\berror\b|failed/i.test(line),
  );
  if (!detail) return undefined;
  let clean = detail.replace(URL_CREDENTIALS, "");
  for (const pattern of TOKEN_PATTERNS) {
    clean = clean.replace(pattern, "[redacted]");
  }
  clean = clean.replace(/["']/g, "").trim();
  if (!clean) return undefined;
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

/**
 * Reads the category out of a failure's error text and describes it. Anything unrecognised is
 * honestly reported as `unknown` rather than guessed at.
 */
export function failureReasonFor(input: {
  error: string;
  stage?: string | undefined;
}): FailureReason {
  const match = CATEGORY_PATTERNS.find(({ pattern }) =>
    pattern.test(input.error),
  );
  if (!match) {
    return {
      category: "unknown",
      message: input.stage
        ? `The ${input.stage} stage failed.`
        : "A stage of the run failed.",
      recovery: "Open the run log, fix the cause, then restart the run.",
    };
  }
  // "A git or pull-request operation failed." told an operator nothing about
  // what git actually said; the underlying error rides along, sanitised.
  if (match.category === "git") {
    const detail = gitErrorDetail(input.error);
    if (detail) {
      return {
        category: "git",
        message: `A git or pull-request operation failed: ${detail}`,
        recovery: CATEGORY_COPY.git.recovery,
      };
    }
  }
  return { category: match.category, ...CATEGORY_COPY[match.category] };
}
