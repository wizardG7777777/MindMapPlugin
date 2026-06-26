export type ErrorDetails = Record<string, unknown>;

export class MindMapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
  }

  toPayload(): { ok: false; error: { code: string; message: string; details: ErrorDetails } } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export class ValidationError extends MindMapError {
  constructor(message: string, details: ErrorDetails = {}) {
    super('VALIDATION_ERROR', message, details);
  }
}

export class ConflictError extends MindMapError {
  constructor(message: string, details: ErrorDetails = {}) {
    super('CONFLICT', message, details);
  }
}

export class ToolInputError extends MindMapError {
  constructor(message: string, details: ErrorDetails = {}) {
    super('TOOL_INPUT_ERROR', message, details);
  }
}
