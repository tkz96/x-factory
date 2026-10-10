// src/http/route-contract.ts — the uniform shape every route-table entry and
// handler shares (#192).
//
// A leaf module: the table (dispatch) and the OpenAPI generator both import
// these types, so neither has to import the other.

import type { ApiContext } from "../composition-root.js";

/** HTTP methods the API dispatches. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One matched request handed to a route handler. `params` carries the named
 * segments of the matched pattern (e.g. `{ id: "run-1" }`), so no handler
 * counts path segments or reads positional parts again.
 */
export interface RouteRequest {
  readonly req: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly ctx: ApiContext;
}

/** The single handler signature every route table entry uses. */
export type RouteHandler = (
  request: RouteRequest,
) => Promise<Response> | Response;

/** One declarative route: method + path pattern → handler, with doc metadata. */
export interface RouteEntry {
  readonly method: HttpMethod;
  /** OpenAPI-style path template, e.g. `/api/projects/{id}/tickets`. */
  readonly path: string;
  readonly handler: RouteHandler;
  /** OpenAPI tag(s) the generated operation belongs to. */
  readonly tags: readonly string[];
  readonly summary: string;
  readonly operationId: string;
  readonly responseDescription: string;
}
