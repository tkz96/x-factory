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
 * Thrown when an operation conflicts with the current entity state or concurrency revision.
 */
export class ConflictError extends DomainError {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}
