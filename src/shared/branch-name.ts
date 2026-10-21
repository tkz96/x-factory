// src/shared/branch-name.ts — The rules of `git check-ref-format --branch`, in
// TypeScript. The API process validates a run's branch without ever shelling
// out to git: it must never run work, and a branch that reaches the prepare
// stage must already be a name git accepts.

import { hasControlCharacters } from "./validation.js";

/** Characters no ref may contain (`git check-ref-format`). */
const FORBIDDEN_CHARACTERS = /[~^:?*[\\]/;

/**
 * Why `name` is not a branch name git would accept, or `null` when it is.
 * Mirrors `git check-ref-format --branch`: no "..", no control characters or
 * space, no ~^:?*[\, no leading "-", not "@", no "@{", no leading, trailing
 * or doubled "/", no trailing ".", and no component that starts with "." or
 * ends with ".lock".
 */
export function branchNameError(name: string): string | null {
  if (name.length === 0) return "A branch name cannot be empty.";
  if (hasControlCharacters(name) || name.includes(" "))
    return "A branch name cannot contain spaces or control characters.";
  if (name.includes("..")) return 'A branch name cannot contain "..".';
  if (FORBIDDEN_CHARACTERS.test(name))
    return 'A branch name cannot contain "~", "^", ":", "?", "*" or "[".';
  if (name.startsWith("-")) return 'A branch name cannot start with "-".';
  if (name === "@") return 'A branch cannot be named "@".';
  if (name.includes("@{")) return 'A branch name cannot contain "@{".';
  if (name.startsWith("/") || name.endsWith("/"))
    return 'A branch name cannot start or end with "/".';
  if (name.includes("//")) return 'A branch name cannot contain "//".';
  if (name.endsWith(".")) return 'A branch name cannot end with ".".';
  for (const component of name.split("/")) {
    if (component.startsWith("."))
      return 'A branch name component cannot start with ".".';
    if (component.endsWith(".lock"))
      return 'A branch name component cannot end with ".lock".';
  }
  return null;
}

/** Whether `name` is a branch name git would accept. */
export function isValidBranchName(name: string): boolean {
  return branchNameError(name) === null;
}

/**
 * The branch names a run can never take because the repository starts from
 * them: `main` and `master`, and the project's own default branches. Compared
 * case-insensitively — "Main" collides with "main" on a case-insensitive
 * filesystem all the same.
 */
export function isReservedRunBranch(
  name: string,
  defaultBranches: readonly string[],
): boolean {
  const lower = name.trim().toLowerCase();
  if (lower === "main" || lower === "master") return true;
  return defaultBranches.some(
    (branch) => branch.trim().toLowerCase() === lower,
  );
}
