/** Domain errors the HTTP layer maps to status codes. No constructor parameter properties (strip-types). */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The request is valid but conflicts with the current state (HTTP 409). `code` is machine readable. */
export class ConflictError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

export class StepTimeoutError extends Error {
  readonly step: string;
  constructor(step: string) {
    super(`timeout:${step}`);
    this.name = "StepTimeoutError";
    this.step = step;
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "JobCancelledError";
  }
}
