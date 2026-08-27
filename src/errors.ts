import type { Change } from './convert.js';

export type DriftErrorCode = 'BAD_INPUT' | 'PARSE_FAILED' | 'MULTI_DOCUMENT' | 'LOSS_IN_STRICT_MODE';

/**
 * Every throw from {@link import('./convert.js').convert} or
 * {@link import('./convert.js').inspect} is a `YamlDriftError` and nothing else
 * escapes either function.
 */
export class YamlDriftError extends Error {
  readonly name = 'YamlDriftError' as const;
  readonly code: DriftErrorCode;
  readonly changes: readonly Change[];

  constructor(code: DriftErrorCode, message: string, changes: readonly Change[] = []) {
    super(message);
    this.code = code;
    this.changes = changes;
    Object.setPrototypeOf(this, YamlDriftError.prototype);
  }
}
