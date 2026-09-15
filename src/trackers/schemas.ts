// src/trackers/schemas.ts — Zod schemas for external tracker API responses.

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

/** WIQL query response: { workItems: [{ id: number }] } */
export const AzureWiqlResponseSchema = z
  .object({
    workItems: z.array(z.object({ id: z.number() }).passthrough()).optional(),
  })
  .passthrough();

/** Work item batch response: { value: [{ id, fields, _links? }] } */
export const AzureWorkItemBatchSchema = z
  .object({
    value: z.array(
      z
        .object({
          id: z.number(),
          fields: z.record(z.string(), z.unknown()),
          _links: z
            .object({
              html: z
                .object({ href: z.string().optional() })
                .passthrough()
                .optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type AzureWorkItemBatch = z.infer<typeof AzureWorkItemBatchSchema>;
export type AzureWorkItem = AzureWorkItemBatch["value"][number];

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const BaseGitHubIssue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string() }).passthrough()]))
    .optional(),
  url: z.string().optional(),
});

/** GitHub Issues list response: array of issue objects */
export const GitHubIssueListSchema = z.array(
  BaseGitHubIssue.extend({
    html_url: z.string().optional(),
    pull_request: z.unknown().optional(),
  }).passthrough(),
);

/** GitHub CLI JSON output — same shape but url instead of html_url */
export const GitHubCliIssueListSchema = z.array(BaseGitHubIssue.passthrough());

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

/** Jira search response: { issues: [{ key, fields: { summary, description?, labels? } }] } */
export const JiraSearchResponseSchema = z
  .object({
    issues: z
      .array(
        z
          .object({
            key: z.string(),
            fields: z
              .object({
                summary: z.string(),
                description: z.unknown().optional(),
                labels: z.array(z.string()).optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
