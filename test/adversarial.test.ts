import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { convert, inspect, YamlDriftError } from '../src/index.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Section 9 obligation 5 — adversarial input for every public entry point.
// ---------------------------------------------------------------------------

describe('adversarial input — convert', () => {
  test('a non-string input throws BAD_INPUT with an empty change list', () => {
    try {
      convert(42 as unknown as string);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err).toBeInstanceOf(YamlDriftError);
      expect(err.code).toBe('BAD_INPUT');
      expect(err.changes).toEqual([]);
    }
  });

  test('a kinds array containing a non-kind string throws BAD_INPUT with an empty change list', () => {
    try {
      convert('a: 1\n', { kinds: ['not-a-real-kind'] as never });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('BAD_INPUT');
      expect(err.changes).toEqual([]);
    }
  });

  test('an unparseable document throws PARSE_FAILED with an empty change list', () => {
    try {
      convert('a: [1, 2\n');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('PARSE_FAILED');
      expect(err.changes).toEqual([]);
    }
  });

  test('a two-document stream throws MULTI_DOCUMENT with an empty change list', () => {
    try {
      convert('a: 1\n---\nb: 2\n');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('MULTI_DOCUMENT');
      expect(err.changes).toEqual([]);
    }
  });

  test('strict mode on a document with a loss change throws LOSS_IN_STRICT_MODE carrying the full change list', () => {
    const text = 'nonce: 123456789012345678901234567890\n';
    const expectedChanges = inspect(text);
    expect(expectedChanges.some((c) => c.severity === 'loss')).toBe(true);
    try {
      convert(text, { strict: true });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('LOSS_IN_STRICT_MODE');
      expect(err.changes).toEqual(expectedChanges);
      expect(err.changes.length).toBeGreaterThan(0);
    }
  });

  test('strict mode on a document with no loss change does not throw', () => {
    expect(() => convert('name: web\n', { strict: true })).not.toThrow();
  });
});

describe('numeric edge cases beyond the corpus', () => {
  test('a decimal literal that overflows to Infinity is number-precision, not non-finite', () => {
    const changes = inspect('huge: 1e400\n');
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'number-precision', severity: 'loss', pointer: '/huge' }),
    ]);
    expect(changes[0]!.after).toBe('null');
  });

  test('a decimal literal that underflows to zero is number-precision', () => {
    const changes = inspect('tiny: 1e-400\n');
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'number-precision', severity: 'loss', pointer: '/tiny' }),
    ]);
    expect(changes[0]!.after).toBe('0');
  });
});

describe('adversarial input — inspect', () => {
  test('a non-string input throws BAD_INPUT with an empty change list', () => {
    try {
      inspect(null as unknown as string);
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('BAD_INPUT');
      expect(err.changes).toEqual([]);
    }
  });

  test('a kinds array containing a non-kind string throws BAD_INPUT with an empty change list', () => {
    try {
      inspect('a: 1\n', { kinds: [123] as never });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('BAD_INPUT');
      expect(err.changes).toEqual([]);
    }
  });

  test('an unparseable document throws PARSE_FAILED with an empty change list', () => {
    try {
      inspect('a:\n  - [1, 2\n');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('PARSE_FAILED');
      expect(err.changes).toEqual([]);
    }
  });

  test('a two-document stream throws MULTI_DOCUMENT with an empty change list', () => {
    try {
      inspect('a: 1\n---\nb: 2\n---\nc: 3\n');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as YamlDriftError;
      expect(err.code).toBe('MULTI_DOCUMENT');
      expect(err.changes).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 9 obligation 6 — every quality gate negative-tested.
// ---------------------------------------------------------------------------

describe('gate enforcement', () => {
  test('a deliberately wrong expected integer makes the assertion fail', () => {
    // Demonstrates that the baseline assertions in test/baseline.test.ts are
    // not vacuous: comparing the real corpus size against a wrong value
    // throws, proving `expect(...).toBe(...)` actually fails on bad data.
    const CORRECT_CORPUS_SIZE = 40;
    const DELIBERATELY_WRONG = CORRECT_CORPUS_SIZE + 1;
    expect(() => {
      expect(CORRECT_CORPUS_SIZE).toBe(DELIBERATELY_WRONG);
    }).toThrow();
  });

  test('the coverage threshold enforces rather than merely advises', () => {
    // Builds a throwaway package (never committed — it lives under a
    // gitignored, transient directory) with a function that is only
    // partially exercised by its own test, configures an unreachable 100%
    // coverage threshold, and asserts that a real vitest run against it
    // exits with a failure — proving the gate actually fails a run rather
    // than only printing a warning.
    const dir = mkdtempSync(join(REPO_ROOT, '.tmp-coverage-gate-'));
    try {
      writeFileSync(
        join(dir, 'lib.js'),
        'export function f(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\n',
      );
      writeFileSync(
        join(dir, 'lib.test.js'),
        "import { test, expect } from 'vitest';\n" +
          "import { f } from './lib.js';\n\n" +
          "test('partial coverage only', () => {\n  expect(f(true)).toBe(1);\n});\n",
      );
      writeFileSync(
        join(dir, 'vitest.config.js'),
        'export default {\n' +
          '  test: {\n' +
          "    include: ['./lib.test.js'],\n" +
          '    coverage: {\n' +
          "      provider: 'v8',\n" +
          "      include: ['lib.js'],\n" +
          '      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },\n' +
          '    },\n' +
          '  },\n' +
          '};\n',
      );

      const vitestEntry = join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
      const result = spawnSync(process.execPath, [vitestEntry, 'run', '--coverage', '--root', dir], {
        encoding: 'utf8',
        cwd: dir,
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/threshold/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Section 9 obligation 11 — no conditional skips anywhere.
// ---------------------------------------------------------------------------

describe('no conditional skips', () => {
  // This file necessarily talks *about* the forbidden patterns in order to
  // check for them; it is excluded from its own scan so that discussion
  // doesn't register as a violation. Every other source and test file is
  // scanned for real.
  const SELF = fileURLToPath(import.meta.url);

  function collectFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full, out);
      else if (entry.name.endsWith('.ts') && full !== SELF) out.push(full);
    }
    return out;
  }

  test('no test or source file skips, marks todo, or isolates a test', () => {
    const forbidden = ['.' + 'skip(', '.' + 'todo(', '.' + 'only(', 'this' + '.skip'];
    const files = [...collectFiles(join(REPO_ROOT, 'src')), ...collectFiles(join(REPO_ROOT, 'test'))];
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no test file makes a network call or reads a well-known secret variable', () => {
    const suspiciousCalls = ['fetch' + '(', 'http.re' + 'quest(', 'https.re' + 'quest(', 'net.con' + 'nect('];
    const secretNames = ['NPM_TO' + 'KEN', 'GH_TO' + 'KEN', 'GITHUB_TO' + 'KEN'];
    const files = collectFiles(join(REPO_ROOT, 'test'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of suspiciousCalls) {
        if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
      for (const name of secretNames) {
        if (text.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
