import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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
    writeFileSync(join(installDir, 'package.json'), JSON.stringify({ name: 'yaml-drift-consumer', version: '0.0.0', private: true }));
    const install = run('npm', ['install', '--offline', tarballPath], installDir);
    expect(install.status).toBe(0);
    pkgDir = join(installDir, 'node_modules', 'yaml-drift');
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
