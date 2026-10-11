// src/shared/failure-reason.ts — The structured reason behind a failed run (#256).
//
// A run that ends in `failed` records why, in words an operator can act on: a category, a
// plain-language message and the recovery the UI can suggest. The raw error text stays on the
// status event's `text`, so this module never has to guess at diagnostic detail.

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
  /** One sentence for an operator; never the raw error text. */
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
      "Check the model connection and its key in Settings, then restart the run.",
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
  return { category: match.category, ...CATEGORY_COPY[match.category] };
}
