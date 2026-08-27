#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convert, formatChanges, YamlDriftError } from './index.js';

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const HELP = `Usage: yaml-drift [file] [options]

Convert a YAML document to JSON and report every value whose meaning changed.

Options:
  --check    exit with code 2 if any change has severity "loss"
  --quiet    suppress the change report on stderr
  --help     show this help and exit
  --version  show the version and exit

If no file is given, reads standard input.`;

function readInput(file: string | undefined): string {
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

export function run(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== '--');

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(readPackageVersion() + '\n');
    return 0;
  }

  const check = args.includes('--check');
  const quiet = args.includes('--quiet');
  const file = args.find((a) => !a.startsWith('-'));

  try {
    const text = readInput(file);
    const result = convert(text);
    process.stdout.write(result.json + '\n');
    if (!quiet) {
      const report = formatChanges(result.changes);
      if (report) process.stderr.write(report + '\n');
    }
    if (check && result.changes.some((c) => c.severity === 'loss')) {
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof YamlDriftError) {
      process.stderr.write(`${err.code}: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/* c8 ignore start -- exercised through the built binary in the tarball smoke test */
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2));
}
/* c8 ignore stop */
