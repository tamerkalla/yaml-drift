import {
  LineCounter,
  parseAllDocuments,
  parseDocument,
  stringify as yamlStringify,
  visit,
  isAlias,
  isMap,
  isScalar,
  isSeq,
} from 'yaml';
import type { Document } from 'yaml';
import { KINDS, SEVERITY, type ChangeKind, type Severity } from './kinds.js';
import { YamlDriftError } from './errors.js';

export type { ChangeKind, Severity } from './kinds.js';
export { KINDS, SEVERITY } from './kinds.js';
export type { DriftErrorCode } from './errors.js';
export { YamlDriftError } from './errors.js';

export interface Change {
  readonly kind: ChangeKind;
  readonly severity: Severity;
  /** RFC 6901 JSON Pointer into `Result.value`. The empty string is the root. */
  readonly pointer: string;
  /** The YAML source text of the node the change is about. */
  readonly source: string;
  /** What the YAML says, rendered as text. */
  readonly before: string;
  /** What the JSON says, rendered as text. */
  readonly after: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

export interface ConvertOptions {
  /** Kinds to report. Default: every member of KINDS. */
  readonly kinds?: readonly ChangeKind[];
  /** Default false. When true, any change of severity 'loss' throws. */
  readonly strict?: boolean;
}

export interface Result {
  readonly value: unknown;
  readonly json: string;
  readonly changes: readonly Change[];
}

type Range = readonly [number, number, number];

interface WalkCtx {
  readonly text: string;
  readonly lineCounter: LineCounter;
  readonly y11Values: ReadonlyMap<string, unknown>;
  readonly changes: Change[];
  readonly doc: Document;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function pointerToken(raw: string): string {
  return raw.replace(/~/g, '~0').replace(/\//g, '~1');
}

function appendPointer(base: string, token: string): string {
  return `${base}/${pointerToken(token)}`;
}

function rangeOf(node: unknown): Range | undefined {
  const r = (node as { range?: Range }).range;
  return r ?? undefined;
}

function nodeSource(ctx: WalkCtx, range: Range | undefined): string {
  if (!range) return '';
  return ctx.text.slice(range[0], range[1]);
}

function nodePos(ctx: WalkCtx, range: Range | undefined): { line: number; column: number } {
  if (!range) return { line: 1, column: 1 };
  const { line, col } = ctx.lineCounter.linePos(range[0]);
  return { line, column: col };
}

function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function sameResolved(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function isNonFiniteToken(sourceText: string): boolean {
  return /^[+-]?\.inf$/i.test(sourceText) || /^\.nan$/i.test(sourceText);
}

/** Converts a YAML source literal + its resolved core value into a drift finding, if any. */
function analyzeNumber(
  literalText: string,
  value: number,
): { kind: 'number-precision' | 'number-literal'; after: string } | null {
  const intMatch = /^([+-]?)(0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|\d+)$/.exec(literalText);
  if (intMatch) {
    const negative = intMatch[1] === '-';
    let exact: bigint;
    try {
      exact = BigInt(intMatch[2]);
    } catch {
      return null;
    }
    if (negative) exact = -exact;

    let matches = false;
    if (Number.isInteger(value)) {
      try {
        matches = BigInt(value) === exact;
      } catch {
        matches = false;
      }
    }
    if (!matches) {
      return { kind: 'number-precision', after: renderScalar(value) };
    }
    const canonical = String(value);
    if (literalText !== canonical) {
      return { kind: 'number-literal', after: canonical };
    }
    return null;
  }

  // Decimal / exponential literal.
  if (!Number.isFinite(value)) {
    return { kind: 'number-precision', after: 'null' };
  }
  if (value === 0 && /[1-9]/.test(literalText)) {
    return { kind: 'number-precision', after: '0' };
  }
  const canonical = String(value);
  if (literalText !== canonical) {
    return { kind: 'number-literal', after: canonical };
  }
  return null;
}

function keyToJsonKey(doc: Document, keyNode: unknown): string {
  try {
    const v = (keyNode as { toJS: (doc: Document) => unknown }).toJS(doc);
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return yamlStringify(v, { flow: true }).trim();
    return String(v);
  } catch {
    return nodeSource({ text: doc.toString() } as WalkCtx, rangeOf(keyNode)) || '?';
  }
}

/** Produces a JSON-safe deep copy: breaks cycles into null, converts Buffer/Set/Map. */
function sanitize(v: unknown, ancestors: ReadonlySet<object>): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return v.toString('base64');
  if (ancestors.has(v)) return null;
  const next = new Set(ancestors);
  next.add(v);
  if (v instanceof Set) {
    return [...v].map((x) => sanitize(x, next));
  }
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v) out[String(k)] = sanitize(val, next);
    return out;
  }
  if (Array.isArray(v)) {
    return v.map((x) => sanitize(x, next));
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = sanitize((v as Record<string, unknown>)[k], next);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

function pushChange(
  ctx: WalkCtx,
  kind: ChangeKind,
  pointer: string,
  range: Range | undefined,
  before: string,
  after: string,
): void {
  const { line, column } = nodePos(ctx, range);
  ctx.changes.push({
    kind,
    severity: SEVERITY[kind],
    pointer,
    source: nodeSource(ctx, range),
    before,
    after,
    line,
    column,
  });
}

function walkScalar(ctx: WalkCtx, node: { tag?: string; value: unknown; range?: Range }, pointer: string): void {
  const range = rangeOf(node);

  if (node.tag !== undefined) {
    pushChange(ctx, 'tag-dropped', pointer, range, `tagged ${node.tag}`, renderScalar(sanitize(node.value, new Set())));
    return;
  }

  const value = node.value;
  const sourceText = nodeSource(ctx, range).trim();

  const key = range ? `${range[0]}:${range[1]}` : undefined;
  if (key !== undefined && ctx.y11Values.has(key)) {
    const y11Value = ctx.y11Values.get(key);
    if (!sameResolved(value, y11Value)) {
      pushChange(ctx, 'dialect', pointer, range, renderScalar(y11Value), renderScalar(value));
    }
  }

  if (typeof value === 'number') {
    if (isNonFiniteToken(sourceText)) {
      pushChange(ctx, 'non-finite', pointer, range, sourceText, 'null');
      return;
    }
    const numChange = analyzeNumber(sourceText, value);
    if (numChange) {
      pushChange(ctx, numChange.kind, pointer, range, sourceText, numChange.after);
    }
  }
}

function walkMapChildren(
  ctx: WalkCtx,
  node: { items: readonly { key: unknown; value: unknown }[] },
  pointer: string,
  ancestors: ReadonlySet<object>,
): void {
  const seenKeys = new Map<string, Range | undefined>();
  for (const pair of node.items) {
    const keyNode = pair.key;
    const keyRange = rangeOf(keyNode);
    const jsonKey = keyToJsonKey(ctx.doc, keyNode);
    const childPointer = appendPointer(pointer, jsonKey);

    const isMergePair = isScalar(keyNode) && keyNode.value === '<<' && (keyNode as { tag?: string }).tag === undefined;
    if (isMergePair) {
      pushChange(
        ctx,
        'merge-key',
        childPointer,
        keyRange,
        '<< merges anchors into this mapping (YAML 1.1)',
        "literal '<<' key (JSON)",
      );
      pushChange(
        ctx,
        'dialect',
        childPointer,
        keyRange,
        'anchors merged into this mapping',
        "literal '<<' key kept",
      );
    } else if (isScalar(keyNode) && typeof keyNode.value !== 'string') {
      pushChange(ctx, 'key-coerced', childPointer, keyRange, renderScalar(keyNode.value), JSON.stringify(jsonKey));
    } else if (!isScalar(keyNode)) {
      pushChange(
        ctx,
        'key-coerced',
        childPointer,
        keyRange,
        nodeSource(ctx, keyRange) || 'complex key',
        JSON.stringify(jsonKey),
      );
    }

    const prior = seenKeys.get(jsonKey);
    if (prior !== undefined || seenKeys.has(jsonKey)) {
      pushChange(
        ctx,
        'key-collision',
        childPointer,
        prior,
        nodeSource(ctx, prior),
        `overwritten; final value kept at ${childPointer}`,
      );
    }
    seenKeys.set(jsonKey, keyRange);

    walk(ctx, pair.value, childPointer, ancestors);
  }
}

function walkSeqChildren(
  ctx: WalkCtx,
  node: { items: readonly unknown[] },
  pointer: string,
  ancestors: ReadonlySet<object>,
): void {
  node.items.forEach((item, idx) => {
    walk(ctx, item, appendPointer(pointer, String(idx)), ancestors);
  });
}

function walk(ctx: WalkCtx, node: unknown, pointer: string, ancestors: ReadonlySet<object>): void {
  if (node === null || node === undefined) return;

  if (isAlias(node)) {
    const range = rangeOf(node);
    pushChange(ctx, 'alias', pointer, range, 'alias reference', 'inlined copy');
    const target = node.resolve(ctx.doc);
    if (target && ancestors.has(target as object)) {
      pushChange(ctx, 'cycle', pointer, range, 'circular reference', 'null');
    }
    return;
  }

  if (isScalar(node)) {
    walkScalar(ctx, node as { tag?: string; value: unknown; range?: Range }, pointer);
    return;
  }

  if (isMap(node) || isSeq(node)) {
    const tag = (node as { tag?: string }).tag;
    if (tag !== undefined) {
      pushChange(ctx, 'tag-dropped', pointer, rangeOf(node), `tagged ${tag}`, 'plain JSON collection');
      return;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node as object);
    if (isMap(node)) {
      walkMapChildren(ctx, node as { items: readonly { key: unknown; value: unknown }[] }, pointer, nextAncestors);
    } else {
      walkSeqChildren(ctx, node as { items: readonly unknown[] }, pointer, nextAncestors);
    }
  }
}

function collectY11Values(y11Doc: Document): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (y11Doc.contents === null) return map;
  visit(y11Doc, (_key, node) => {
    if (isScalar(node)) {
      const range = rangeOf(node);
      if (range) map.set(`${range[0]}:${range[1]}`, node.value);
    }
  });
  return map;
}

function sortChanges(changes: readonly Change[]): Change[] {
  const order = new Map(KINDS.map((k, i) => [k, i]));
  return [...changes].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0);
  });
}

function validateKinds(kinds: unknown): readonly ChangeKind[] | undefined {
  if (kinds === undefined) return undefined;
  const valid = (KINDS as readonly string[]).slice();
  if (!Array.isArray(kinds) || !kinds.every((k) => typeof k === 'string' && valid.includes(k))) {
    throw new YamlDriftError('BAD_INPUT', 'options.kinds must be an array of ChangeKind values');
  }
  return kinds as readonly ChangeKind[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function convert(text: string, options?: ConvertOptions): Result {
  if (typeof text !== 'string') {
    throw new YamlDriftError('BAD_INPUT', 'text must be a string');
  }
  const kinds = validateKinds(options?.kinds);
  const strict = options?.strict === true;

  const lineCounter = new LineCounter();
  // logLevel: 'error' silences yaml's process-level `emitWarning` side channel
  // (used only for its own "complex map key" stringification notice below);
  // it does not affect doc.errors/doc.warnings, which is a separate mechanism
  // this function relies on for PARSE_FAILED.
  const docs = parseAllDocuments(text, { schema: 'core', lineCounter, logLevel: 'error' });
  if (docs.length > 1) {
    throw new YamlDriftError('MULTI_DOCUMENT', 'input contains more than one YAML document');
  }
  const doc = docs[0] ?? parseDocument(text, { schema: 'core', lineCounter, logLevel: 'error' });
  if (doc.errors.length > 0) {
    throw new YamlDriftError('PARSE_FAILED', doc.errors[0]?.message ?? 'failed to parse YAML');
  }

  const y11Doc = parseDocument(text, { schema: 'yaml-1.1', logLevel: 'error' });
  const y11Values = collectY11Values(y11Doc);

  const ctx: WalkCtx = { text, lineCounter, y11Values, changes: [], doc };
  walk(ctx, doc.contents, '', new Set());

  const filtered = kinds ? ctx.changes.filter((c) => kinds.includes(c.kind)) : ctx.changes;
  const changes = sortChanges(filtered);

  const rawValue = doc.contents === null ? null : doc.toJS();
  const value = sanitize(rawValue, new Set());
  const json = JSON.stringify(value) ?? 'null';

  if (strict && changes.some((c) => c.severity === 'loss')) {
    throw new YamlDriftError('LOSS_IN_STRICT_MODE', 'conversion has changes of severity "loss"', changes);
  }

  return { value, json, changes };
}

export function inspect(text: string, options?: ConvertOptions): readonly Change[] {
  const withoutStrict: ConvertOptions = options ? { ...options, strict: false } : { strict: false };
  return convert(text, withoutStrict).changes;
}
