import type { ChangeKind, Severity } from '../src/index.js';

export interface CorpusDoc {
  readonly name: string;
  readonly source: string;
  /** The exact, complete set of ChangeKind values `inspect` must report for this document. */
  readonly kinds: readonly ChangeKind[];
}

// Section 2.1 — the forty documents. Complete and exact; do not add, remove, or reorder.
const RAW_CORPUS: readonly CorpusDoc[] = [
    { name: 'plain-strings', source: 'name: service\nimage: nginx\n', kinds: [] },
    { name: 'plain-numbers', source: 'replicas: 3\nport: 8080\n', kinds: [] },
    { name: 'plain-bools', source: 'enabled: true\ndebug: false\n', kinds: [] },
    { name: 'nested', source: 'spec:\n  template:\n    name: web\n', kinds: [] },
    { name: 'list', source: 'args:\n  - --verbose\n  - --port=80\n', kinds: [] },
    { name: 'quoted-no', source: 'country: "NO"\n', kinds: [] },
    { name: 'bare-no', source: 'country: NO\n', kinds: ['dialect'] },
    { name: 'bare-yes', source: 'confirm: yes\n', kinds: ['dialect'] },
    { name: 'bare-on-off', source: 'tls: on\ncompression: off\n', kinds: ['dialect'] },
    { name: 'single-letter-y', source: 'answer: y\n', kinds: ['dialect'] },
    { name: 'sexagesimal-time', source: 'cron_window: 12:30\n', kinds: ['dialect'] },
    { name: 'sexagesimal-triple', source: 'elapsed: 1:2:3\n', kinds: ['dialect'] },
    { name: 'underscore-int', source: 'threshold: 1_000\n', kinds: ['dialect'] },
    { name: 'binary-literal', source: 'mask: 0b1010\n', kinds: ['dialect'] },
    { name: 'legacy-octal', source: 'mode: 0755\n', kinds: ['dialect', 'number-literal'] },
    { name: 'zip-leading-zero', source: 'zip: 01234\n', kinds: ['dialect', 'number-literal'] },
    { name: 'hex', source: 'color: 0x1F\n', kinds: ['number-literal'] },
    { name: 'bare-date', source: 'released: 2001-12-14\n', kinds: ['dialect'] },
    {
      name: 'bare-datetime',
      source: 'created: 2001-12-14T21:59:43.10-05:00\n',
      kinds: ['dialect'],
    },
    { name: 'version-1-10', source: 'version: 1.10\n', kinds: ['number-literal'] },
    { name: 'positive-infinity', source: 'limit: .inf\n', kinds: ['non-finite'] },
    { name: 'negative-infinity', source: 'floor: -.inf\n', kinds: ['non-finite'] },
    { name: 'not-a-number', source: 'ratio: .nan\n', kinds: ['non-finite'] },
    { name: 'int-above-2p53', source: 'id: 9007199254740993\n', kinds: ['number-precision'] },
    {
      name: 'snowflake-id',
      source: 'message_id: 1284016338956615682\n',
      kinds: ['number-precision'],
    },
    {
      name: 'huge-int',
      source: 'nonce: 123456789012345678901234567890\n',
      kinds: ['number-precision'],
    },
    { name: 'negative-zero', source: 'delta: -0.0\n', kinds: ['number-literal'] },
    {
      name: 'float-tail',
      source: 'epsilon: 0.1000000000000000055511151231257827\n',
      kinds: ['number-literal'],
    },
    {
      name: 'key-int-and-string',
      source: '1: one\n"1": two\n',
      kinds: ['key-coerced', 'key-collision'],
    },
    { name: 'key-bool', source: 'true: enabled\n', kinds: ['key-coerced'] },
    { name: 'key-null', source: 'null: nothing\n', kinds: ['key-coerced'] },
    { name: 'key-sequence', source: '? [a, b]\n: pair\n', kinds: ['key-coerced'] },
    { name: 'key-mapping', source: '? {a: 1}\n: nested\n', kinds: ['key-coerced'] },
    {
      name: 'merge-key',
      source: 'base: &b\n  cpu: 1\nchild:\n  <<: *b\n  mem: 2\n',
      kinds: ['alias', 'dialect', 'merge-key'],
    },
    { name: 'alias-shared', source: 'anchor: &a {k: 1}\nuse: *a\n', kinds: ['alias'] },
    { name: 'alias-cycle', source: '&root\nself: *root\n', kinds: ['alias', 'cycle'] },
    {
      name: 'tag-binary',
      source: 'blob: !!binary "R0lGODlhAQABAAAAACw="\n',
      kinds: ['tag-dropped'],
    },
    {
      name: 'tag-set',
      source: 'members: !!set\n  ? alice\n  ? bob\n',
      kinds: ['tag-dropped'],
    },
    {
      name: 'tag-omap',
      source: 'ordered: !!omap\n  - a: 1\n  - b: 2\n',
      kinds: ['tag-dropped'],
    },
    { name: 'tag-custom', source: 'thing: !mytag 1\n', kinds: ['tag-dropped'] },
];

export const CORPUS: readonly CorpusDoc[] = Object.freeze(RAW_CORPUS.map((d) => Object.freeze(d)));

// Section 2.2 — corpus outcomes.
export const CORPUS_SIZE = 40;
export const EMPTY_DOCUMENT_COUNT = 6;
export const NONEMPTY_DOCUMENT_COUNT = 34;
export const DISTINCT_KIND_COUNT = 10;

// Section 2.3 — per-kind document counts. The column sums to 40.
export const KIND_DOCUMENT_COUNTS: Readonly<Record<ChangeKind, number>> = Object.freeze({
  dialect: 13,
  'number-literal': 6,
  'key-coerced': 5,
  'tag-dropped': 4,
  'non-finite': 3,
  'number-precision': 3,
  alias: 3,
  'key-collision': 1,
  'merge-key': 1,
  cycle: 1,
});

// Section 2.5 — severity totals, counted over the rows of section 2.3.
export const SEVERITY_TOTALS: Readonly<Record<Severity, number>> = Object.freeze({
  dialect: 14,
  format: 14,
  loss: 12,
});

// Section 2.6 — the control: documents for which yaml@2.9.0's core schema
// surfaces an error or a warning.
export const CONTROL_ERROR_OR_WARNING_COUNT = 1;
export const CONTROL_ERROR_OR_WARNING_DOCS: readonly string[] = Object.freeze(['tag-custom']);

// Section 2.7 — library differential: js-yaml@5.4.1 vs yaml@2.9.0, default
// settings, JSON.stringify of the parsed result (or the fact that one throws
// and the other doesn't).
export const DIFFERENTIAL_COUNT = 8;
export const DIFFERENTIAL_DOCS: readonly string[] = Object.freeze([
  'key-int-and-string',
  'key-null',
  'key-sequence',
  'key-mapping',
  'tag-binary',
  'tag-set',
  'tag-omap',
  'tag-custom',
]);
