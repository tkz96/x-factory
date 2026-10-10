// src/http/route-contract.ts — the uniform shape every route-table entry and
// handler shares (#192).
//
// A leaf module: the table (dispatch) and the OpenAPI generator both import
// these types, so neither has to import the other.

import type { ApiContext } from "../composition-root.js";

/** HTTP methods the API dispatches. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** No named segments. A mapped-over-never empty record, not the banned `{}`. */
type NoParams = { readonly [K in never]: never };

/**
 * The named segments a path template declares, e.g. `{ id: string }` for
 * `/api/runs/{id}`. A handler can only read params its own pattern declares, so
 * a template typo such as `{idd}` is a compile error, not a runtime `undefined`.
 * A bare `string` (an erased runtime path) falls back to an open record.
 */
export type ParamsOf<Path extends string> = string extends Path
  ? Record<string, string>
  : Path extends `${string}{${infer Param}}${infer Rest}`
    ? { readonly [K in Param]: string } & ParamsOf<Rest>
    : NoParams;

/**
 * One matched request handed to a route handler. `params` carries the named
 * segments of the matched pattern (e.g. `{ id: "run-1" }`), so no handler
 * counts path segments or reads positional parts again.
 */
export interface RouteRequest<
  Params extends Record<string, string> = Record<string, string>,
> {
  readonly req: Request;
  readonly url: URL;
  readonly params: Readonly<Params>;
  readonly ctx: ApiContext;
}

/** The single handler signature every route table entry uses. */
export type RouteHandler<
  Params extends Record<string, string> = Record<string, string>,
> = (request: RouteRequest<Params>) => Promise<Response> | Response;

/** One declarative route: method + path pattern → handler, with doc metadata. */
export interface RouteEntry<Path extends string = string> {
  readonly method: HttpMethod;
  /** OpenAPI-style path template, e.g. `/api/projects/{id}/tickets`. */
  readonly path: Path;
  readonly handler: RouteHandler<ParamsOf<Path>>;
  /** OpenAPI tag(s) the generated operation belongs to. */
  readonly tags: readonly string[];
  readonly summary: string;
  readonly operationId: string;
  readonly responseDescription: string;
}
