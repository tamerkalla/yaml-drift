import type { Change } from './convert.js';

/**
 * Renders a change list as one line per change:
 *
 *     <line>:<column>  <severity>  <kind>  <pointer>  <before> -> <after>
 *
 * An empty array formats to the empty string. `pointer` renders as `/` when
 * it is the empty string (the root).
 */
export function formatChanges(changes: readonly Change[]): string {
  return changes
    .map((c) => {
      const pointer = c.pointer === '' ? '/' : c.pointer;
      return `${c.line}:${c.column}  ${c.severity}  ${c.kind}  ${pointer}  ${c.before} -> ${c.after}`;
    })
    .join('\n');
}
