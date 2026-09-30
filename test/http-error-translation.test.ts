import { describe, expect, it } from "bun:test";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../src/errors.js";
import { handleProjectsRoute } from "../src/http/projects-controller.js";
import {
  catchHttpErrors,
  HttpError,
  translateDomainErrorToHttpResponse,
} from "../src/http/responses.js";
import { handleRunsRoute } from "../src/http/runs-controller.js";

describe("HTTP Layer Error Translation", () => {
  it("translates neutral NotFoundError into standard 404 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new NotFoundError("Entity missing");
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Entity missing" });
  });

  it("translates neutral ValidationError into standard 400 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ValidationError("Parameter invalid");
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Parameter invalid" });
  });

  it("translates neutral ConflictError into standard 409 response", async () => {
    const res = await catchHttpErrors(async () => {
      throw new ConflictError("Concurrent modification conflict");
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Concurrent modification conflict" });
  });

  it("translates presentation HttpError to specified status code", async () => {
    const res = await catchHttpErrors(async () => {
      throw new HttpError(422, "Unprocessable payload");
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: "Unprocessable payload" });
  });

  it("translates unhandled generic Error to 500", async () => {
    const res = await catchHttpErrors(async () => {
      throw new Error("Unexpected internal failure");
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Unexpected internal failure" });
  });

  it("translateDomainErrorToHttpResponse directly converts domain errors", async () => {
    const notFoundRes = translateDomainErrorToHttpResponse(
      new NotFoundError("Not here"),
    );
    expect(notFoundRes).not.toBeNull();
    expect(notFoundRes?.status).toBe(404);
    expect(await notFoundRes?.json()).toEqual({ error: "Not here" });

    const validationRes = translateDomainErrorToHttpResponse(
      new ValidationError("Bad argument"),
    );
    expect(validationRes).not.toBeNull();
    expect(validationRes?.status).toBe(400);
    expect(await validationRes?.json()).toEqual({ error: "Bad argument" });

    const conflictRes = translateDomainErrorToHttpResponse(
      new ConflictError("Revision mismatch"),
    );
    expect(conflictRes).not.toBeNull();
    expect(conflictRes?.status).toBe(409);
    expect(await conflictRes?.json()).toEqual({ error: "Revision mismatch" });
  });

  it("runs controller translates neutral NotFoundError to 404 response on chat", async () => {
    const req = new Request("http://localhost/api/runs/nonexistent-run/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello world" }),
    });

    const res = await handleRunsRoute(
      "POST",
      "nonexistent-run",
      "chat",
      3,
      req,
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: "Run nonexistent-run not found." });
  });

  it("projects controller translates neutral NotFoundError to 404 response on delete", async () => {
    const req = new Request("http://localhost/api/projects/nonexistent-proj", {
      method: "DELETE",
    });

    const res = await handleProjectsRoute(
      "DELETE",
      "nonexistent-proj",
      undefined,
      undefined,
      2,
      req,
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res?.json();
    expect(body).toEqual({ error: 'Project "nonexistent-proj" not found.' });
  });

  it("projects controller translates neutral ValidationError to 400 response on discover-repositories", async () => {
    const req = new Request(
      "http://localhost/api/projects/discover-repositories",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "nonexistent-provider" }),
      },
    );

    const res = await handleProjectsRoute(
      "POST",
      "discover-repositories",
      undefined,
      undefined,
      2,
      req,
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.error).toContain("Unsupported discovery provider");
  });
});
