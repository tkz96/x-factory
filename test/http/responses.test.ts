import { describe, expect, it } from "bun:test";
import {
  ConflictError,
  NotFoundError,
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

  it("translates native Error to 500", async () => {
    const res = await catchHttpErrors(async () => {
      throw new Error("Synthetic database failure");
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Synthetic database failure");
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
});
