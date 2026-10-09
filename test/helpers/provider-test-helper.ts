// test/helpers/provider-test-helper.ts — Shared test helpers for provider responses and in-memory transport (#173).

import type { HttpTransport } from "../../src/providers/http.js";

/**
 * Creates a JSON Response with application/json Content-Type.
 */
export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    ...init,
    headers,
  });
}

/**
 * Creates a plain text Response.
 */
export function textResponse(text: string, init: ResponseInit = {}): Response {
  return new Response(text, {
    status: init.status ?? 200,
    ...init,
  });
}

/**
 * Creates an HTML Response with text/html Content-Type.
 */
export function htmlResponse(html: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html");
  }
  return new Response(html, {
    status: init.status ?? 200,
    ...init,
    headers,
  });
}

export type RouteHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Creates an in-memory HTTP transport routing requests by string match or predicate.
 */
export function createInMemoryTransport(
  routes: Array<{
    match: string | RegExp | ((url: string, init?: RequestInit) => boolean);
    handler: Response | RouteHandler;
  }>,
  fallback: Response | RouteHandler = textResponse("Not Found", {
    status: 404,
  }),
): HttpTransport {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const execute = async (): Promise<Response> => {
      for (const route of routes) {
        const matched =
          typeof route.match === "string"
            ? url.includes(route.match)
            : route.match instanceof RegExp
              ? route.match.test(url)
              : route.match(url, init);

        if (matched) {
          return typeof route.handler === "function"
            ? await route.handler(url, init)
            : route.handler.clone();
        }
      }

      return typeof fallback === "function"
        ? await fallback(url, init)
        : fallback.clone();
    };

    if (init?.signal) {
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => {
          const reason = init.signal?.reason;
          if (reason instanceof Error) {
            reject(reason);
          } else {
            reject(new DOMException("The request was aborted", "AbortError"));
          }
        };
        init.signal?.addEventListener("abort", onAbort, { once: true });
        execute()
          .then((res) => {
            init.signal?.removeEventListener("abort", onAbort);
            resolve(res);
          })
          .catch((err) => {
            init.signal?.removeEventListener("abort", onAbort);
            reject(err);
          });
      });
    }

    return execute();
  };
}
