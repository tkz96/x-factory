// src/frontend/wizard/state/repositoryUrl.ts — The first step's one rule: what
// counts as a repository URL (#268, spec #241 story 112).
//
// Pure and descriptor-free: it decides only whether the text LOOKS like a
// repository URL. Which provider claims it is the providers' own question,
// asked through `api.providers.parseUrl` — an unrecognised URL is never a
// block, because the next step lets the user connect a provider by hand.

import { REPOSITORY_STEP_COPY } from "../../components/feedback/copy-map.js";

/** An `http(s)://`, `ssh://`, `git://` URL, or the scp-like `user@host:path`. */
const SCP_LIKE = /^[^\s/@]+@[^\s/@:]+:\S+$/;
const SCHEMED = /^(https?|ssh|git):\/\/\S+$/i;

/** The message for a URL the user left invalid, or null when it passes. */
export function repositoryUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return REPOSITORY_STEP_COPY.urlRequired;
  }
  if (trimmed.includes(" ")) {
    return REPOSITORY_STEP_COPY.urlInvalid;
  }
  if (SCHEMED.test(trimmed) || SCP_LIKE.test(trimmed)) {
    return null;
  }
  return REPOSITORY_STEP_COPY.urlInvalid;
}
