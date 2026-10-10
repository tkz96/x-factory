import { describe, expect, it } from "bun:test";
import {
  ConflictError,
  NotFoundError,
  SemanticValidationError,
  ValidationError,
} from "../../src/errors.js";
import {
  catchHttpErrors,
  HttpError,
  translateDomainErrorToHttpResponse,
} from "../../src/http/responses.js";

describe("catchHttpErrors", () => {
  it("translates NotFoundError to 404", async () => {
    const res = await catchHttpErrors(async () => {
      throw new NotFoundError("Oops");
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Oops");
  });

  it("translates ValidationError to 400", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ValidationError("Invalid field input");
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid field input");
  });

  it("translates ConflictError to 409", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ConflictError("Resource state conflict");
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Resource state conflict");
  });

  it("translates HttpError to custom status", async () => {
    const res = await catchHttpErrors(async () => {
      throw new HttpError(418, "I'm a teapot");
    });
    expect(res.status).toBe(418);
    const body = await res.json();
    expect(body.error).toBe("I'm a teapot");
  });

  it("translates native Error to the generic 500 envelope", async () => {
    const res = await catchHttpErrors(async () => {
      throw new Error("Synthetic database failure");
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    // #163 B2: the raw text can quote SQL, a path or a secret, so it is only
    // logged server-side. test/http-error-translation.test.ts owns the log-side
    // assertion at the dispatch boundary.
    expect(body).toEqual({ error: "Internal error", code: "INTERNAL" });
  });
});

describe("translateDomainErrorToHttpResponse", () => {
  it("returns null for non-domain errors", () => {
    expect(translateDomainErrorToHttpResponse(new Error("random"))).toBeNull();
    expect(translateDomainErrorToHttpResponse("string-error")).toBeNull();
  });

  it("maps error subclasses matching by name", () => {
    const customNotFound = new Error("Named not found");
    customNotFound.name = "NotFoundError";
    const res = translateDomainErrorToHttpResponse(customNotFound);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
  });

  it("returns a 409 empty envelope — never throws — for a name-only semantic error missing its members", async () => {
    // A cross-realm / duck-typed error that matches by name but carries none of
    // the structured members. The translator must not escalate an intended 409
    // into an unhandled failure by reading members that are not there.
    const impostor = new Error("semantic");
    impostor.name = "SemanticValidationError";

    const res = catchHttpErrors(async () => {
      throw impostor;
    });
    await expect(res).resolves.toBeInstanceOf(Response);

    const translated = await res;
    expect(translated.status).toBe(409);
    expect(await translated.json()).toEqual({});
  });

  it("keeps the structured members of a real SemanticValidationError in its 409 envelope", async () => {
    const res = catchHttpErrors(async () => {
      throw new SemanticValidationError({
        formErrors: ["MISSING_TRACKER_CONNECTION"],
        fieldErrors: { host: "REQUIRED" },
      });
    });
    const translated = await res;
    expect(translated.status).toBe(409);
    expect(await translated.json()).toEqual({
      fieldErrors: { host: "REQUIRED" },
      formErrors: ["MISSING_TRACKER_CONNECTION"],
    });
  });

  it("drops a non-array formErrors rather than throwing on it", async () => {
    const impostor = new Error("semantic");
    impostor.name = "SemanticValidationError";
    (impostor as unknown as { formErrors: unknown }).formErrors =
      "not-an-array";

    const translated = translateDomainErrorToHttpResponse(impostor);
    expect(translated?.status).toBe(409);
    expect(await translated?.json()).toEqual({});
  });
});
