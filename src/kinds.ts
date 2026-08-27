/**
 * The ten ways a YAML document's meaning can drift on the way to JSON.
 *
 * Order matters: it is the tie-breaker used by {@link import('./convert.js').convert}
 * when two changes land on the same line and column (see spec section 6.10).
 */
export type ChangeKind =
  | 'dialect'
  | 'number-precision'
  | 'number-literal'
  | 'non-finite'
  | 'key-coerced'
  | 'key-collision'
  | 'merge-key'
  | 'alias'
  | 'cycle'
  | 'tag-dropped';

export type Severity = 'loss' | 'dialect' | 'format';

export const KINDS: readonly ChangeKind[] = [
  'dialect',
  'number-precision',
  'number-literal',
  'non-finite',
  'key-coerced',
  'key-collision',
  'merge-key',
  'alias',
  'cycle',
  'tag-dropped',
];

export const SEVERITY: Readonly<Record<ChangeKind, Severity>> = {
  dialect: 'dialect',
  'merge-key': 'dialect',
  'number-precision': 'loss',
  'non-finite': 'loss',
  'key-collision': 'loss',
  cycle: 'loss',
  'tag-dropped': 'loss',
  'number-literal': 'format',
  'key-coerced': 'format',
  alias: 'format',
};
