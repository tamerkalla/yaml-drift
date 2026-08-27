import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  convert,
  formatChanges,
  inspect,
  KINDS,
  SEVERITY,
  YamlDriftError,
  type ChangeKind,
} from '../src/index.js';

let stdinContent = '';
let failPackageJsonRead = false;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((path: unknown, enc?: unknown) => {
      if (path === 0) return stdinContent;
      if (failPackageJsonRead && String(path).endsWith('package.json')) {
        throw new Error('simulated read failure');
      }
      return actual.readFileSync(path as string, enc as BufferEncoding);
    }),
  };
});

describe('public surface', () => {
  test('KINDS is exactly the ten documented kinds, in the documented order', () => {
    expect(KINDS).toEqual([
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
    ]);
  });

  test('SEVERITY matches the documented table exactly', () => {
    const expected: Record<ChangeKind, string> = {
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
    expect(SEVERITY).toEqual(expected);
    for (const kind of KINDS) {
      expect(SEVERITY[kind]).toBe(expected[kind]);
    }
  });

  test('convert returns value, json and changes', () => {
    const result = convert('a: 1\n');
    expect(result.value).toEqual({ a: 1 });
    expect(result.json).toBe('{"a":1}');
    expect(result.changes).toEqual([]);
  });

  test('every Change carries the documented fields', () => {
    const [change] = inspect('country: NO\n');
    expect(change).toMatchObject({
      kind: 'dialect',
      severity: 'dialect',
      pointer: '/country',
    });
    expect(typeof change.source).toBe('string');
    expect(typeof change.before).toBe('string');
    expect(typeof change.after).toBe('string');
    expect(typeof change.line).toBe('number');
    expect(typeof change.column).toBe('number');
  });

  test('YamlDriftError exposes name, code and changes', () => {
    try {
      convert(42 as unknown as string);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(YamlDriftError);
      expect(e).toBeInstanceOf(Error);
      const err = e as YamlDriftError;
      expect(err.name).toBe('YamlDriftError');
      expect(err.code).toBe('BAD_INPUT');
      expect(err.changes).toEqual([]);
    }
  });
});

describe('6.13 formatChanges', () => {
  test('an empty array formats to the empty string', () => {
    expect(formatChanges([])).toBe('');
  });

  test('one line per change, fields joined by two spaces', () => {
    const changes = inspect('country: NO\n');
    const lines = formatChanges(changes).split('\n');
    expect(lines.length).toBe(changes.length);
    const [c] = changes;
    expect(lines[0]).toBe(`${c.line}:${c.column}  ${c.severity}  ${c.kind}  ${c.pointer}  ${c.before} -> ${c.after}`);
  });

  test('the root pointer renders as /', () => {
    const changes = inspect('&root\nself: *root\n');
    const cycleChange = changes.find((c) => c.kind === 'cycle')!;
    expect(cycleChange.pointer).toBe('/self');
    // Construct a change with an empty pointer to check root rendering.
    const rootChange = { ...cycleChange, pointer: '' };
    expect(formatChanges([rootChange])).toContain('  /  ');
  });

  test('lines are joined in the given order without a trailing newline', () => {
    const changes = inspect('mode: 0755\n');
    const out = formatChanges(changes);
    expect(out.endsWith('\n')).toBe(false);
    expect(out.split('\n').length).toBe(changes.length);
  });
});

describe('6.14 CLI', () => {
  let dir: string;
  let stdout: string[];
  let stderr: string[];
  // vi.spyOn's inferred type depends on the exact overload of `write` it
  // matches; typing these precisely isn't worth it in a test file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  let run: (argv: readonly string[]) => number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'yaml-drift-cli-'));
    stdout = [];
    stderr = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
    ({ run } = await import('../src/cli.js'));
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    failPackageJsonRead = false;
    vi.resetModules();
  });

  test('reads a file, writes json to stdout and the report to stderr', () => {
    const file = join(dir, 'in.yaml');
    writeFileSync(file, 'country: NO\n');
    const code = run([file]);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('{"country":"NO"}\n');
    expect(stderr.join('')).toContain('dialect');
  });

  test('reads standard input when no file is given', () => {
    stdinContent = 'name: web\n';
    const code = run([]);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('{"name":"web"}\n');
    expect(stderr.join('')).toBe('');
  });

  test('--quiet suppresses the stderr report', () => {
    const file = join(dir, 'in.yaml');
    writeFileSync(file, 'country: NO\n');
    const code = run([file, '--quiet']);
    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
  });

  test('--check exits 2 when a change has severity loss', () => {
    const file = join(dir, 'in.yaml');
    writeFileSync(file, 'id: 9007199254740993\n');
    const code = run([file, '--check']);
    expect(code).toBe(2);
  });

  test('--check exits 0 when no change has severity loss', () => {
    const file = join(dir, 'in.yaml');
    writeFileSync(file, 'name: web\n');
    const code = run([file, '--check']);
    expect(code).toBe(0);
  });

  test('--help writes usage to stdout and exits 0', () => {
    const code = run(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('Usage: yaml-drift');
  });

  test('--version writes the version to stdout and exits 0', () => {
    const code = run(['--version']);
    expect(code).toBe(0);
    expect(stdout.join('').trim().length).toBeGreaterThan(0);
  });

  test('--version falls back to 0.0.0 when package.json cannot be read', () => {
    failPackageJsonRead = true;
    const code = run(['--version']);
    expect(code).toBe(0);
    expect(stdout.join('').trim()).toBe('0.0.0');
  });

  test('a YamlDriftError prints "<code>: <message>" to stderr and exits 1', () => {
    const file = join(dir, 'bad.yaml');
    writeFileSync(file, 'a: [1, 2\n');
    const code = run([file]);
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/^PARSE_FAILED: /);
  });

  test('a non-YamlDriftError (e.g. a missing file) prints its message and exits 1', () => {
    const code = run([join(dir, 'does-not-exist.yaml')]);
    expect(code).toBe(1);
    expect(stderr.join('').length).toBeGreaterThan(0);
  });
});
