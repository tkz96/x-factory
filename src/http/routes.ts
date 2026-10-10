// src/http/routes.ts — the API entry point: request guard, correlation id and
// dispatch through the declarative route table (#192).

import type { ApiContext } from "../composition-root.js";
import { emitStructuredLog, extractRequestId } from "../shared/correlation.js";
import { DEFAULT_API_GUARD, guardApiRequest } from "./request-guard.js";
import { errorResponse } from "./responses.js";
import { dispatchApi } from "./route-table.js";

export async function handleApi(
  req: Request,
  url: URL,
  ctx: ApiContext,
): Promise<Response> {
  const method = req.method;
  const requestId = extractRequestId(req);

  const rejected = guardApiRequest(req, ctx.guard ?? DEFAULT_API_GUARD);
  if (rejected) {
    rejected.headers.set("X-Request-ID", requestId);
    return rejected;
  }

  try {
    const response =
      (await dispatchApi(req, url, ctx)) ||
      errorResponse("Endpoint not found.", 404);

    // Propagate standard correlation ID in HTTP headers (XFM-73)
    response.headers.set("X-Request-ID", requestId);
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emitStructuredLog(
      "error",
      `API Error [${method} ${url.pathname}]: ${message}`,
      { request_id: requestId },
    );
    const errRes = errorResponse(message, 500);
    errRes.headers.set("X-Request-ID", requestId);
    return errRes;
  }
}
