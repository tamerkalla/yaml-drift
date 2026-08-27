import { describe, expect, test } from 'vitest';
import * as YAML from 'yaml';
import { convert, inspect } from '../src/index.js';
import { CORPUS } from './corpus.js';

describe('6.10 determinism', () => {
  test('two calls on the same input produce deeply equal results', () => {
    for (const doc of CORPUS) {
      const a = convert(doc.source);
      const b = convert(doc.source);
      expect(b).toEqual(a);
    }
  });
});

describe('6.11 purity', () => {
  test('neither convert nor inspect mutates the input text', () => {
    const text = 'country: NO\n';
    const copy = String(text);
    convert(text);
    inspect(text);
    expect(text).toBe(copy);
  });

  test('both work correctly when options is deep-frozen', () => {
    const options = Object.freeze({
      kinds: Object.freeze(['dialect']) as readonly ['dialect'],
      strict: false,
    });
    expect(() => convert('country: NO\n', options)).not.toThrow();
    expect(() => inspect('country: NO\n', options)).not.toThrow();
    const result = convert('country: NO\nmode: 0755\n', options);
    expect(result.changes.every((c) => c.kind === 'dialect')).toBe(true);
  });

  test('does not mutate a frozen options object', () => {
    const options = Object.freeze({ strict: true });
    expect(() => convert('name: web\n', options)).not.toThrow();
    expect(options.strict).toBe(true);
  });
});

describe('6.12 inspect/convert identity', () => {
  test('inspect(text, o) equals convert(text, o).changes when convert does not throw', () => {
    for (const doc of CORPUS) {
      expect(inspect(doc.source)).toEqual(convert(doc.source).changes);
    }
  });

  test('inspect never throws LOSS_IN_STRICT_MODE', () => {
    const lossy = 'nonce: 123456789012345678901234567890\n';
    expect(() => convert(lossy, { strict: true })).toThrow();
    expect(() => inspect(lossy, { strict: true })).not.toThrow();
    expect(inspect(lossy, { strict: true })).toEqual(convert(lossy).changes);
  });

  test('inspect throws identically for every other code', () => {
    const cases: { text: string; options?: { kinds?: never } }[] = [
      { text: 123 as unknown as string },
      { text: 'a: 1\n', options: { kinds: ['nope'] as never } },
      { text: 'a: [1, 2\n' },
      { text: 'a: 1\n---\nb: 2\n' },
    ];

    for (const { text, options } of cases) {
      let convertCode: unknown;
      let inspectCode: unknown;
      try {
        convert(text, options);
      } catch (e) {
        convertCode = (e as { code?: unknown }).code;
      }
      try {
        inspect(text, options);
      } catch (e) {
        inspectCode = (e as { code?: unknown }).code;
      }
      expect(convertCode).toBeDefined();
      expect(inspectCode).toBe(convertCode);
    }
  });
});

describe('6.1 round-trip for clean documents', () => {
  test('JSON.parse(convert(text).json) deep-equals YAML.parse(text) for every document reporting no changes', () => {
    const clean = CORPUS.filter((d) => d.kinds.length === 0);
    expect(clean.length).toBeGreaterThan(0);
    for (const doc of clean) {
      const result = convert(doc.source);
      expect(result.changes).toEqual([]);
      expect(JSON.parse(result.json)).toEqual(YAML.parse(doc.source));
    }
  });
});
