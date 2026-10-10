// src/http/schemas.ts — Zod schemas for HTTP request validation.

import { z } from "zod/v4";
import {
  ProjectConnectionInputSchema,
  ProjectInputSchema,
} from "../config-schema.js";
import {
  type ProjectMigrationInput,
  ProjectMigrationInputSchema,
} from "../providers/project-config.js";
import { hasControlCharacters } from "../shared/validation.js";

/** Request body schema for POST /api/settings (#163 B4). */
export const WorkbenchSettingsSchema = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  models: z
    .object({
      sessionA: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
        })
        .optional(),
      sessionB: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type WorkbenchSettingsBody = z.infer<typeof WorkbenchSettingsSchema>;

/** Request body schema for POST /api/runs */
export const CreateRunBodySchema = z
  .object({
    projectId: z
      .string({ error: "Project ID is required." })
      .min(1, "Project ID is required."),
    ticketId: z.string().optional(),
    ticketTitle: z.string().optional(),
    plan: z.string().optional(),
    acceptanceCriteria: z.union([z.string(), z.array(z.string())]).optional(),
    description: z.string().optional(),
    branch: z.string().optional(),
  })
  .passthrough();

/** Request body schema for POST /api/runs/:id/chat */
export const ChatRunBodySchema = z
  .object({
    message: z
      .string({ error: "message is required." })
      .trim()
      .min(1, "message is required."),
  })
  .passthrough();

/** Request body schema for saving / creating projects */
export const SaveProjectBodySchema = ProjectInputSchema;

/** Request body schema for updating a project's normalized connections (#145). */
export const UpdateProjectConnectionsBodySchema = z.looseObject({
  name: z.string().optional(),
  workspacePath: z.string().optional(),
  gitIdentity: z
    .object({ name: z.string().min(1), email: z.string().min(1) })
    .optional(),
  connections: z.array(ProjectConnectionInputSchema).min(1),
  /** Secret field names to clear, applied before validation (#131). */
  clearSecrets: z.array(z.string().min(1)).optional(),
});

/**
 * Request body schema for POST /api/projects/:id/migrate (#163 B1), derived from
 * the provider layer's `ProjectMigrationInputSchema` so the wire contract and
 * the migration input are one shape and cannot drift.
 */
export const MigrateProjectBodySchema = ProjectMigrationInputSchema;

export type MigrateProjectBody = ProjectMigrationInput;

/** Request body schema for POST /api/runs/:id/transitions */
export const TransitionRunBodySchema = z
  .object({
    action: z.enum(["approve", "restart", "abort", "requeue"]),
    payload: z
      .object({
        failingTasks: z.array(z.string()).optional(),
        chatNotes: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Request body schema for configuring git identity (#161) */
export const ConfigureGitIdentityBodySchema = z.looseObject({
  path: z.string({ error: "Path is required." }).min(1, "Path is required."),
  name: z
    .string({ error: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .refine(
      (val) => !hasControlCharacters(val),
      "Name must not contain control characters.",
    ),
  email: z.email(),
  scope: z.enum(["local", "global"]).optional(),
});
