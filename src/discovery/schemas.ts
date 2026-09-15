// src/discovery/schemas.ts — Zod schemas for external repository discovery API responses.

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

/** Azure Git Repositories API response: { value: [{ id, name, ... }] } */
export const AzureRepoListSchema = z
  .object({
    value: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            url: z.string().optional(),
            remoteUrl: z.string().optional(),
            webUrl: z.string().optional(),
            defaultBranch: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/** GitHub Repositories list response */
export const GitHubRepoListSchema = z.array(
  z
    .object({
      id: z.number(),
      name: z.string(),
      full_name: z.string().optional(),
      clone_url: z.string().optional(),
      html_url: z.string(),
      default_branch: z.string().optional(),
    })
    .passthrough(),
);

export type GitHubRepoList = z.infer<typeof GitHubRepoListSchema>;
export type GitHubRepoItem = GitHubRepoList[number];

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

/** Jira project components list response */
export const JiraComponentListSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    })
    .passthrough(),
);
