// src/http/schemas.ts — Zod schemas for HTTP request validation.

import { z } from "zod/v4";
import { ProjectInputSchema } from "../config-schema.js";

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
  })
  .passthrough();

/** Request body schema for saving / creating projects */
export const SaveProjectBodySchema = ProjectInputSchema;

/** Request body schema for updating projects */
export const UpdateProjectBodySchema = z.record(z.string(), z.unknown());
