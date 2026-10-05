// src/http/schemas.ts — Zod schemas for HTTP request validation.

import { z } from "zod/v4";
import {
  ProjectConnectionInputSchema,
  ProjectInputSchema,
} from "../config-schema.js";

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

/** Request body schema for POST /api/runs/:id/steer */
export const SteerRunBodySchema = z
  .object({
    message: z
      .string({ error: "Message is required." })
      .trim()
      .min(1, "Message is required."),
    commandId: z.string().optional(),
    command_id: z.string().optional(),
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
export const UpdateProjectConnectionsBodySchema = z
  .object({
    name: z.string().optional(),
    workspacePath: z.string().optional(),
    gitIdentity: z
      .object({ name: z.string().min(1), email: z.string().min(1) })
      .optional(),
    connections: z.array(ProjectConnectionInputSchema).min(1),
    /** Secret field names to clear, applied before validation (#131). */
    clearSecrets: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

/** Request body schema for updating projects */
export const UpdateProjectBodySchema = z.record(z.string(), z.unknown());

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
