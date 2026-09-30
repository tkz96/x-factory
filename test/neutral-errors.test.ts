import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { deleteProject } from "../src/config.js";
import {
  IllegalStateTransitionError,
  RunNotFoundError,
  StaleRevisionError,
} from "../src/db/run-repository.js";
import { getDiscoveryProvider } from "../src/discovery/index.js";
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from "../src/errors.js";
import { HttpError } from "../src/http/responses.js";
import { chatWithRun, steerRun, stopRun } from "../src/runs.js";

describe("Neutral Domain Errors", () => {
  it("defines presentation-agnostic error hierarchy", () => {
    const notFound = new NotFoundError("Missing item");
    expect(notFound).toBeInstanceOf(Error);
    expect(notFound).toBeInstanceOf(DomainError);
    expect(notFound).toBeInstanceOf(NotFoundError);
    expect(notFound.name).toBe("NotFoundError");
    expect(notFound.message).toBe("Missing item");
    expect(
      (notFound as unknown as Record<string, unknown>).status,
    ).toBeUndefined();
    expect(notFound).not.toBeInstanceOf(HttpError);

    const validation = new ValidationError("Invalid value");
    expect(validation).toBeInstanceOf(Error);
    expect(validation).toBeInstanceOf(DomainError);
    expect(validation).toBeInstanceOf(ValidationError);
    expect(validation.name).toBe("ValidationError");
    expect(validation.message).toBe("Invalid value");
    expect(
      (validation as unknown as Record<string, unknown>).status,
    ).toBeUndefined();
    expect(validation).not.toBeInstanceOf(HttpError);

    const conflict = new ConflictError("Version mismatch");
    expect(conflict).toBeInstanceOf(Error);
    expect(conflict).toBeInstanceOf(DomainError);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(conflict.name).toBe("ConflictError");
    expect(conflict.message).toBe("Version mismatch");
    expect(
      (conflict as unknown as Record<string, unknown>).status,
    ).toBeUndefined();
    expect(conflict).not.toBeInstanceOf(HttpError);
  });

  it("ensures db repository errors extend neutral domain errors", () => {
    const runNotFound = new RunNotFoundError("run-123");
    expect(runNotFound).toBeInstanceOf(NotFoundError);
    expect(runNotFound).toBeInstanceOf(DomainError);
    expect(runNotFound.message).toBe('Run "run-123" not found.');
    expect(runNotFound.runId).toBe("run-123");
    expect(runNotFound).not.toBeInstanceOf(HttpError);

    const staleRev = new StaleRevisionError("run-123", 2, 1);
    expect(staleRev).toBeInstanceOf(ConflictError);
    expect(staleRev).toBeInstanceOf(DomainError);
    expect(staleRev.name).toBe("StaleRevisionError");
    expect(staleRev).not.toBeInstanceOf(HttpError);

    const illegalTransition = new IllegalStateTransitionError(
      "queued",
      "ready_for_pr",
    );
    expect(illegalTransition).toBeInstanceOf(ConflictError);
    expect(illegalTransition).toBeInstanceOf(DomainError);
    expect(illegalTransition.name).toBe("IllegalStateTransitionError");
    expect(illegalTransition).not.toBeInstanceOf(HttpError);
  });

  it("src/runs.ts throws neutral NotFoundError with preserved message", async () => {
    let thrownError: unknown;
    try {
      await chatWithRun("nonexistent-test-run", "hello");
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(NotFoundError);
    expect(thrownError).not.toBeInstanceOf(HttpError);
    expect((thrownError as Error).message).toBe(
      "Run nonexistent-test-run not found.",
    );

    try {
      await steerRun("nonexistent-test-run", "steer command");
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(NotFoundError);
    expect(thrownError).not.toBeInstanceOf(HttpError);
    expect((thrownError as Error).message).toBe(
      "Run nonexistent-test-run not found.",
    );

    try {
      await stopRun("nonexistent-test-run");
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(NotFoundError);
    expect(thrownError).not.toBeInstanceOf(HttpError);
    expect((thrownError as Error).message).toBe(
      "Run nonexistent-test-run not found.",
    );
  });

  it("src/config.ts throws neutral NotFoundError with preserved message", async () => {
    let thrownError: unknown;
    try {
      await deleteProject("nonexistent-project-xyz");
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(NotFoundError);
    expect(thrownError).not.toBeInstanceOf(HttpError);
    expect((thrownError as Error).message).toBe(
      'Project "nonexistent-project-xyz" not found.',
    );
  });

  it("src/discovery/index.ts throws neutral ValidationError with preserved message", () => {
    expect(() => getDiscoveryProvider("unsupported-provider-xyz")).toThrow(
      ValidationError,
    );
    try {
      getDiscoveryProvider("unsupported-provider-xyz");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).not.toBeInstanceOf(HttpError);
      expect((err as Error).message).toContain(
        'Unsupported discovery provider "unsupported-provider-xyz"',
      );
    }
  });

  it("verifies no non-presentation modules import from src/http/*", () => {
    function getFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "http" && entry.name !== "frontend") {
            results.push(...getFiles(full));
          }
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          if (entry.name !== "server.ts") {
            results.push(full);
          }
        }
      }
      return results;
    }

    const srcDir = path.join(process.cwd(), "src");
    const nonPresentationFiles = getFiles(srcDir);
    expect(nonPresentationFiles.length).toBeGreaterThan(15);

    const httpImportPattern = /from\s+["'].*http\//;

    for (const filePath of nonPresentationFiles) {
      const content = readFileSync(filePath, "utf-8");
      const relative = path.relative(process.cwd(), filePath);
      expect({
        file: relative,
        hasHttpImport: httpImportPattern.test(content),
      }).toEqual({
        file: relative,
        hasHttpImport: false,
      });
    }
  });
});
