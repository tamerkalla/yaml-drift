import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CORPUS } from './corpus.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function run(cmd: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Installs a packed tarball into node_modules by extracting it directly and
// copying yaml@2.9.0 from this repo's own node_modules, rather than running
// `npm install`. A real `npm install` of a fresh, lockfile-less consumer
// project needs to fetch package *metadata* (not just a cached tarball) to
// resolve the `yaml` dependency, which `npm ci` alone never caches — so
// `--offline` fails on a runner whose cache was only ever populated by
// `npm ci` (as CI's is), and a non-offline install would reach the network,
// which no test may do. Extracting the tarball and copying the one runtime
// dependency reproduces the exact installed layout with neither problem.
function installTarball(tarballPath: string, installDir: string): string {
  const nodeModules = join(installDir, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  const extract = run('tar', ['-xzf', tarballPath, '-C', nodeModules], installDir);
  expect(extract.status).toBe(0);
  const pkgDir = join(nodeModules, 'yaml-drift');
  cpSync(join(nodeModules, 'package'), pkgDir, { recursive: true });
  rmSync(join(nodeModules, 'package'), { recursive: true, force: true });
  cpSync(join(REPO_ROOT, 'node_modules', 'yaml'), join(nodeModules, 'yaml'), { recursive: true });
  return pkgDir;
}

describe('packed tarball smoke test', () => {
  let packDir: string;
  let installDir: string;
  let tarballPath: string;
  let pkgDir: string;

  beforeAll(() => {
    packDir = mkdtempSync(join(tmpdir(), 'yaml-drift-pack-'));
    const pack = run('npm', ['pack', '--silent', '--pack-destination', packDir], REPO_ROOT);
    expect(pack.status).toBe(0);
    const tarballName = pack.stdout.trim().split('\n').pop()!.trim();
    tarballPath = join(packDir, tarballName);
    expect(existsSync(tarballPath)).toBe(true);

    installDir = mkdtempSync(join(tmpdir(), 'yaml-drift-install-'));
    writeFileSync(
      join(installDir, 'package.json'),
      JSON.stringify({ name: 'yaml-drift-consumer', version: '0.0.0', private: true }),
    );
    pkgDir = installTarball(tarballPath, installDir);
    expect(existsSync(pkgDir)).toBe(true);
  }, 120_000);

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  });

  test('the tarball ships exactly the files listed in the manifest', () => {
    expect(existsSync(join(pkgDir, 'dist'))).toBe(true);
    expect(existsSync(join(pkgDir, 'README.md'))).toBe(true);
    expect(existsSync(join(pkgDir, 'VERIFY.md'))).toBe(true);
    expect(existsSync(join(pkgDir, 'LICENSE'))).toBe(true);
    expect(existsSync(join(pkgDir, 'package.json'))).toBe(true);
  });

  test('ships both an ESM and a CJS entry, plus type declarations for each', () => {
    const distFiles = readdirSync(join(pkgDir, 'dist'));
    expect(distFiles).toContain('index.js');
    expect(distFiles).toContain('index.cjs');
    expect(distFiles).toContain('index.d.ts');
    expect(distFiles).toContain('index.d.cts');
    expect(distFiles).toContain('cli.js');
  });

  test('import works from a clean install', () => {
    const script = join(installDir, 'esm-check.mjs');
    writeFileSync(
      script,
      "import { convert } from 'yaml-drift';\n" + "console.log(convert('country: NO\\n').json);\n",
    );
    const result = run(process.execPath, [script], installDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"country":"NO"}');
  });

  test('require works from a clean install', () => {
    const script = join(installDir, 'cjs-check.cjs');
    writeFileSync(
      script,
      "const { convert } = require('yaml-drift');\n" + "console.log(convert('country: NO\\n').json);\n",
    );
    const result = run(process.execPath, [script], installDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"country":"NO"}');
  });

  test('the CLI binary works from dist/', () => {
    const cliPath = join(pkgDir, 'dist', 'cli.js');
    const result = spawnSync(process.execPath, [cliPath], {
      cwd: installDir,
      input: 'country: NO\n',
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"country":"NO"}');
    expect(result.stderr).toContain('dialect');
  });

  test('headline property reproduces: 34 of 40 corpus documents report at least one change', async () => {
    const entry = pathToFileURL(join(pkgDir, 'dist', 'index.js')).href;
    const installed = (await import(entry)) as { inspect: (text: string) => readonly unknown[] };
    const withChanges = CORPUS.filter((doc) => installed.inspect(doc.source).length > 0);
    expect(withChanges.length).toBe(34);
  });
});
