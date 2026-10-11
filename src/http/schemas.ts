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
/** A role's model (#278); `null` in a settings patch clears the role. */
const RoleAssignmentSchema = z.object({
  connectionId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
});

export const WorkbenchSettingsSchema = z.object({
  theme: z
    .enum(["default", "graphite", "sandstone", "dark", "light"])
    .optional(),
  appearance: z.enum(["automatic", "auto", "light", "dark"]).optional(),

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
  allowUnsandboxed: z.boolean().optional(),
  roles: z
    .object({
      builder: RoleAssignmentSchema.nullable().optional(),
      reviewer: RoleAssignmentSchema.nullable().optional(),
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

/**
 * Request body schema for POST /api/runs/:id/abandon (#182, #163 follow-up).
 *
 * The reason is optional — a bodyless POST from an older client still abandons
 * without one — but when present it must be a string, trimmed, at most 500
 * characters, with no control characters (CR and LF included), so the reason
 * recorded on the status event and the cancelled job text stays printable and
 * bounded.
 */
export const AbandonRunBodySchema = z
  .object({
    reason: z
      .string({ error: "Reason must be a string." })
      .trim()
      .max(500, "Reason must be at most 500 characters.")
      .refine(
        (val) => !hasControlCharacters(val),
        "Reason must not contain control characters.",
      )
      .optional(),
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

// ─── Model connections (#276) ────────────────────────────────────────────────

const ModelApiTypeSchema = z.enum(
  ["openai-compatible", "gemini", "anthropic"],
  {
    error: "API type must be openai-compatible, gemini or anthropic.",
  },
);

export const CreateModelConnectionBodySchema = z.object({
  name: z
    .string({ error: "A connection needs a name." })
    .trim()
    .min(1, "A connection needs a name."),
  apiType: ModelApiTypeSchema,
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional(),
});
export type CreateModelConnectionBody = z.infer<
  typeof CreateModelConnectionBodySchema
>;

export const UpdateModelConnectionBodySchema = z.object({
  name: z.string().trim().min(1, "A connection needs a name.").optional(),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional(),
});
export type UpdateModelConnectionBody = z.infer<
  typeof UpdateModelConnectionBodySchema
>;

// ─── Model records on a connection (#277) ────────────────────────────────────

export const AddConnectionModelBodySchema = z.object({
  modelId: z
    .string({ error: "A model needs an ID." })
    .trim()
    .min(1, "A model needs an ID."),
});
export type AddConnectionModelBody = z.infer<
  typeof AddConnectionModelBodySchema
>;

const PositiveOrNull = z.number().positive().nullable().optional();
const NonNegative = z.number().nonnegative().optional();

export const UpdateConnectionModelBodySchema = z.object({
  contextWindow: PositiveOrNull,
  maxOutputTokens: PositiveOrNull,
  inputPricePerMTok: z.number().nonnegative().nullable().optional(),
  outputPricePerMTok: z.number().nonnegative().nullable().optional(),
  limits: z
    .object({
      rpm: NonNegative,
      tpm: NonNegative,
      rpd: NonNegative,
      tpd: NonNegative,
    })
    .optional(),
  budget: z
    .object({
      perDay: z.object({ usd: NonNegative, requests: NonNegative }),
    })
    .optional(),
});
export type UpdateConnectionModelBody = z.infer<
  typeof UpdateConnectionModelBodySchema
>;
