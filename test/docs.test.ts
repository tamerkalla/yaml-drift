import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Example {
  lang: 'js' | 'bash';
  code: string;
  expected: string;
}

// Finds every (code block, claimed output) pair in a markdown document. The
// convention this project's docs follow: a fenced ```js or ```bash block,
// then a line reading "Output:" or "Expected output:", then a fenced
// ```text block holding the exact text the code is claimed to print.
function extractExamples(markdown: string): Example[] {
  const re = /```(js|bash)\n([\s\S]*?)\n```\n\n(?:Output|Expected output):\n\n```text\n([\s\S]*?)\n```/g;
  const examples: Example[] = [];
  for (const m of markdown.matchAll(re)) {
    examples.push({ lang: m[1] as 'js' | 'bash', code: m[2], expected: m[3] });
  }
  return examples;
}

describe('README.md and VERIFY.md structure', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

  test('opens with the fixed hook', () => {
    expect(readme.startsWith('# yaml-drift\n\n**Your YAML config does not survive the trip to JSON, and nothing tells you.**\n')).toBe(true);
  });

  test('the badge row appears character-for-character, after the hook paragraph', () => {
    const badges = [
      '[![build](https://github.com/tamerkalla/yaml-drift/actions/workflows/release.yml/badge.svg)](https://github.com/tamerkalla/yaml-drift/actions/workflows/release.yml)',
      '[![npm](https://img.shields.io/npm/v/yaml-drift.svg)](https://www.npmjs.com/package/yaml-drift)',
      '[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)',
      '[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen.svg)](https://www.npmjs.com/package/yaml-drift)',
    ].join('\n');
    const badgeIndex = readme.indexOf(badges);
    const hookIndex = readme.indexOf('**Your YAML config does not survive the trip to JSON, and nothing tells you.**');
    expect(badgeIndex).toBeGreaterThan(-1);
    expect(badgeIndex).toBeGreaterThan(hookIndex);
  });

  test('at least one runnable example and the CLI example are present', () => {
    const examples = extractExamples(readme);
    expect(examples.some((e) => e.lang === 'js')).toBe(true);
    expect(examples.some((e) => e.lang === 'bash')).toBe(true);
  });

  test('mentions the three stated non-goals', () => {
    expect(readme).toMatch(/Not a YAML formatter/);
    expect(readme).toMatch(/Not a multi-document tool/);
    expect(readme).toMatch(/Not a fixer/);
  });

  test('links to VERIFY.md', () => {
    expect(readme).toMatch(/\[VERIFY\.md\]\(VERIFY\.md\)/);
  });
});

describe('every code example in README.md is executed and its output matches', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const examples = extractExamples(readme);
  const cliPath = join(ROOT, 'dist', 'cli.js');

  test('at least one example was found', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const [i, example] of examples.entries()) {
    test(`example ${i + 1} (${example.lang}) prints the claimed output`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'yaml-drift-docs-'));
      try {
        if (example.lang === 'js') {
          const script = join(ROOT, `.tmp-doc-example-${i}.mjs`);
          writeFileSync(script, example.code);
          try {
            const result = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe(example.expected.trim());
          } finally {
            rmSync(script, { force: true });
          }
        } else {
          const prepared = example.code.replace(/\byaml-drift\b/g, `${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)}`);
          const result = spawnSync('bash', ['-c', prepared], { cwd: dir, encoding: 'utf8' });
          expect((result.stdout + result.stderr).trim()).toBe(example.expected.trim());
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('every code example in VERIFY.md is executed and its output matches', () => {
  const verify = readFileSync(join(ROOT, 'VERIFY.md'), 'utf8');
  const examples = extractExamples(verify);

  test('does not depend on the repository being checked out', () => {
    expect(verify).toMatch(/does not require this repository to be checked out/);
  });

  test('at least one example was found', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  let tarballPath: string;
  let packDir: string;

  beforeAll(() => {
    packDir = mkdtempSync(join(tmpdir(), 'yaml-drift-verify-pack-'));
    const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', packDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(pack.status).toBe(0);
    const tarballName = pack.stdout.trim().split('\n').pop()!.trim();
    tarballPath = join(packDir, tarballName);
    expect(existsSync(tarballPath)).toBe(true);
  }, 120_000);

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
  });

  for (const [i, example] of examples.entries()) {
    test(`example ${i + 1} reproduces the claimed output`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'yaml-drift-verify-run-'));
      try {
        // The doc installs from the registry; the test instead extracts the
        // tarball this repository just built and copies yaml@2.9.0 from this
        // repo's own node_modules, reproducing the installed layout without
        // `npm install` — which, for a fresh lockfile-less project, needs to
        // fetch package *metadata* (not just a cached tarball) to resolve
        // the `yaml` dependency, and no test may reach the network.
        const replacement = [
          'mkdir -p node_modules',
          `tar -xzf ${JSON.stringify(tarballPath)} -C node_modules`,
          'mv node_modules/package node_modules/yaml-drift',
          `cp -r ${JSON.stringify(join(ROOT, 'node_modules', 'yaml'))} node_modules/yaml`,
        ].join('\n');
        const prepared = example.code.replace('npm install yaml-drift@latest', replacement);
        const result = spawnSync('bash', ['-c', prepared], { cwd: dir, encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(example.expected.trim());
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
