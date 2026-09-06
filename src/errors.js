export const errorGroups = {
  2: ['INVALID_ARGUMENT', 'INVALID_JSON', 'INVALID_ENVELOPE'],
  3: ['INVALID_LAYOUT', 'DOCUMENT_NOT_FOUND', 'ALREADY_EXISTS', 'UNSUPPORTED_SCHEMA', 'INVALID_DOCUMENT', 'NOT_FOUND', 'INVALID_OPERATION', 'SCOPE_VIOLATION', 'LIMIT_EXCEEDED', 'OPERATION_ID_REUSE'],
  4: ['CONFLICT'],
  5: ['LOCK_TIMEOUT', 'LOCK_UNAVAILABLE', 'IO_ERROR', 'UNSUPPORTED_STORAGE', 'COMMIT_OUTCOME_UNKNOWN'],
  6: ['INTERNAL_ERROR'],
};
export class MindmapError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = Number(Object.entries(errorGroups).find(([, codes]) => codes.includes(code))?.[0] ?? 6);
  }
}
export function fail(code, message, details) { throw new MindmapError(code, message, details); }
export function limit(name, maximum, actual, extra = {}) {
  if (actual > maximum) fail('LIMIT_EXCEEDED', `${name} exceeds ${maximum}.`, { limit: name, maximum, actual, ...extra });
}
export function argument(name, reason) { fail('INVALID_ARGUMENT', `Invalid ${name}: ${reason}.`, { argument: name, reason }); }
export function ioError(error, path, phase) {
  if (error instanceof MindmapError) return error;
  if (!error.code) return new MindmapError('INTERNAL_ERROR', error.message, { outcome: 'not_published', phase });
  return new MindmapError('IO_ERROR', `${phase} failed: ${error.message}`, { path, phase, osCode: error.code ?? null });
}
export function observed(error, document) {
  error.documentId = document.metadata.id;
  error.graphVersion = document.metadata.graphVersion;
  return error;
}
