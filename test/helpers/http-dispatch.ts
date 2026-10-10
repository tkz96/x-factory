// test/helpers/http-dispatch.ts — drives a test-built Request through the real
// route table over the in-memory repository bundle a test holds (#192). The
// pre-#192 positional controller shims lived in each test file; this is their
// one home, with the dead positional parameters gone.

import type { Repositories } from "../../src/composition-root.js";
import { handleApi } from "../../src/http/routes.js";

/** Dispatches one request through the real API route table. */
export function dispatchHttp(
  req: Request,
  repos: Repositories,
): Promise<Response> {
  return handleApi(req, new URL(req.url), { repos });
}
