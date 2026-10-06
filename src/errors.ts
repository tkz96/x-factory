// src/errors.ts — Neutral, presentation-agnostic domain and application errors.

/**
 * Base class for all domain and application errors.
 * Completely decoupled from HTTP presentation and status codes.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when an entity, resource, or record is not found.
 */
export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when an input, parameter, or argument fails validation or is invalid.
 */
export class ValidationError extends DomainError {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a request is well formed but semantically invalid against
 * X-Factory's own rules (unknown provider, provider config schema failure,
 * incompatible role/capability, …).
 *
 * Carries codes only: provider and validation messages never cross the API
 * boundary (#129/#131).
 */
export class SemanticValidationError extends DomainError {
  readonly formErrors: string[];
  readonly fieldErrors: Record<string, string>;

  constructor(codes: {
    formErrors?: string[];
    fieldErrors?: Record<string, string>;
  }) {
    super("Semantic validation failed.");
    this.name = "SemanticValidationError";
    this.formErrors = codes.formErrors ?? [];
    this.fieldErrors = codes.fieldErrors ?? {};
  }
}

/**
 * Thrown when an operation conflicts with the current entity state or concurrency revision.
 */
export class ConflictError extends DomainError {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}
