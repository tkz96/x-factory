// test/project-git-identity-schema.test.ts — a project's git identity on update:
// both parts required, the email contains "@".

import { describe, expect, it } from "bun:test";
import { ProjectUpdateBodySchema } from "../src/config-schema.js";

describe("ProjectUpdateBodySchema gitIdentity", () => {
  const parse = (gitIdentity: unknown) =>
    ProjectUpdateBodySchema.safeParse({ gitIdentity }).success;

  it("accepts a name and an email with @", () => {
    expect(parse({ name: "Ada", email: "ada@work.example" })).toBe(true);
  });

  it("rejects an empty name, an empty email, or an email without @", () => {
    expect(parse({ name: " ", email: "ada@work.example" })).toBe(false);
    expect(parse({ name: "Ada", email: "" })).toBe(false);
    expect(parse({ name: "Ada", email: "ada.work.example" })).toBe(false);
  });
});
