import { describe, expect, it } from "bun:test";
import { catchHttpErrors, NotFoundError } from "../../src/http/responses.js";

describe("catchHttpErrors", () => {
  it("translates NotFoundError to 404", async () => {
    const res = await catchHttpErrors(async () => {
      throw new NotFoundError("Oops");
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Oops");
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
