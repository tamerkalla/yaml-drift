import { describe, expect, test } from 'vitest';
import * as YAML from 'yaml';
import * as jsYaml from 'js-yaml';
import { inspect, KINDS, SEVERITY, type ChangeKind } from '../src/index.js';
import {
  CORPUS,
  CORPUS_SIZE,
  EMPTY_DOCUMENT_COUNT,
  NONEMPTY_DOCUMENT_COUNT,
  DISTINCT_KIND_COUNT,
  KIND_DOCUMENT_COUNTS,
  SEVERITY_TOTALS,
  CONTROL_ERROR_OR_WARNING_COUNT,
  CONTROL_ERROR_OR_WARNING_DOCS,
  DIFFERENTIAL_COUNT,
  DIFFERENTIAL_DOCS,
} from './corpus.js';

describe('section 2.1 — the corpus', () => {
  test('corpus size is exactly 40', () => {
    expect(CORPUS.length).toBe(40);
    expect(CORPUS.length).toBe(CORPUS_SIZE);
  });

  test('every document name is unique', () => {
    expect(new Set(CORPUS.map((d) => d.name)).size).toBe(CORPUS.length);
  });
});

describe('section 2.2 — corpus outcomes', () => {
  const results = CORPUS.map((doc) => ({ doc, changes: inspect(doc.source) }));

  test('exactly 6 documents report no changes', () => {
    const empty = results.filter((r) => r.changes.length === 0);
    expect(empty.length).toBe(6);
    expect(empty.length).toBe(EMPTY_DOCUMENT_COUNT);
  });

  test('exactly 34 documents report at least one change', () => {
    const nonEmpty = results.filter((r) => r.changes.length > 0);
    expect(nonEmpty.length).toBe(34);
    expect(nonEmpty.length).toBe(NONEMPTY_DOCUMENT_COUNT);
  });

  test('exactly 10 distinct change kinds are observed across the corpus', () => {
    const kinds = new Set(results.flatMap((r) => r.changes.map((c) => c.kind)));
    expect(kinds.size).toBe(10);
    expect(kinds.size).toBe(DISTINCT_KIND_COUNT);
  });

  test('non-vacuity: at least one document is clean and at least one drifts', () => {
    expect(results.some((r) => r.changes.length === 0)).toBe(true);
    expect(results.some((r) => r.changes.length > 0)).toBe(true);
  });

  test('the six clean documents are exactly the ones named in section 2.2', () => {
    const emptyNames = results.filter((r) => r.changes.length === 0).map((r) => r.doc.name).sort();
    const expected = [
      'plain-strings',
      'plain-numbers',
      'plain-bools',
      'nested',
      'list',
      'quoted-no',
    ].sort();
    expect(emptyNames).toEqual(expected);
  });
});

describe('section 2.4 — per-document kinds (exact set equality)', () => {
  for (const doc of CORPUS) {
    test(`${doc.name} reports exactly {${doc.kinds.join(', ')}}`, () => {
      const got = new Set(inspect(doc.source).map((c) => c.kind));
      expect([...got].sort()).toEqual([...doc.kinds].sort());
    });
  }
});

describe('section 2.3 — per-kind document counts', () => {
  const perKindDocs: Record<ChangeKind, Set<string>> = Object.fromEntries(
    KINDS.map((k) => [k, new Set<string>()]),
  ) as Record<ChangeKind, Set<string>>;

  for (const doc of CORPUS) {
    for (const kind of new Set(inspect(doc.source).map((c) => c.kind))) {
      perKindDocs[kind].add(doc.name);
    }
  }

  for (const kind of KINDS) {
    test(`${kind} appears in exactly ${KIND_DOCUMENT_COUNTS[kind]} document(s)`, () => {
      expect(perKindDocs[kind].size).toBe(KIND_DOCUMENT_COUNTS[kind]);
    });
  }

  test('the column sums to 40', () => {
    const sum = KINDS.reduce((acc, k) => acc + perKindDocs[k].size, 0);
    expect(sum).toBe(40);
  });
});

describe('section 2.5 — severity totals', () => {
  test('severity totals derived from SEVERITY and the per-kind counts match exactly', () => {
    const totals = { dialect: 0, format: 0, loss: 0 };
    for (const kind of KINDS) {
      totals[SEVERITY[kind]] += KIND_DOCUMENT_COUNTS[kind];
    }
    expect(totals).toEqual(SEVERITY_TOTALS);
    expect(totals.dialect).toBe(14);
    expect(totals.format).toBe(14);
    expect(totals.loss).toBe(12);
    expect(totals.dialect + totals.format + totals.loss).toBe(40);
  });
});

describe('section 2.6 — the control', () => {
  test('yaml@2.9.0 core schema surfaces an error or warning for exactly 1 of 40 documents', () => {
    const flagged = CORPUS.filter((doc) => {
      const parsed = YAML.parseDocument(doc.source, { schema: 'core' });
      return parsed.errors.length > 0 || parsed.warnings.length > 0;
    }).map((d) => d.name);
    expect(flagged.length).toBe(CONTROL_ERROR_OR_WARNING_COUNT);
    expect(flagged).toEqual(CONTROL_ERROR_OR_WARNING_DOCS);
  });
});

describe('section 2.7 — library differential', () => {
  test('js-yaml@5.4.1 and yaml@2.9.0 disagree on exactly 8 of 40 documents', () => {
    const mismatches: string[] = [];
    for (const doc of CORPUS) {
      let a: string | undefined;
      let b: string | undefined;
      let aThrew = false;
      let bThrew = false;
      try {
        // logLevel: 'error' only silences yaml's process-level emitWarning
        // side channel (stderr noise for an unresolved tag or a stringified
        // complex key); it does not change the parsed/stringified result.
        a = JSON.stringify(YAML.parse(doc.source, { logLevel: 'error' }));
      } catch {
        aThrew = true;
      }
      try {
        b = JSON.stringify(jsYaml.load(doc.source));
      } catch {
        bThrew = true;
      }
      const differs = aThrew || bThrew ? aThrew !== bThrew : a !== b;
      if (differs) mismatches.push(doc.name);
    }
    expect(mismatches.length).toBe(DIFFERENTIAL_COUNT);
    expect(mismatches).toEqual(DIFFERENTIAL_DOCS);
  });
});
