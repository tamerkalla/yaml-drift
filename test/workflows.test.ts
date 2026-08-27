import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Workflow {
  name: string;
  // Parsed as a plain object; the 'on' key is asserted present before use
  // because YAML 1.1 (unlike the 1.2 core schema this package parses with)
  // resolves a bare `on:` key as the boolean `true`, not the string "on" —
  // a parser using that dialect would silently look up a key that isn't there.
  on?: Record<string, unknown>;
  jobs: Record<string, { steps: Step[]; permissions?: Record<string, string> }>;
}

function loadWorkflow(name: string): Workflow {
  const text = readFileSync(`${ROOT}/.github/workflows/${name}`, 'utf8');
  return YAML.parse(text) as Workflow;
}

describe('.github/workflows/ci.yml', () => {
  const ci = loadWorkflow('ci.yml');

  test('parses to a plain object with a name', () => {
    expect(ci.name).toBe('CI');
  });

  test('the trigger key was actually found', () => {
    expect(Object.prototype.hasOwnProperty.call(ci, 'on')).toBe(true);
    expect(ci.on).toBeTruthy();
  });

  test('does not trigger on pushes to main, but does on pull_request and dispatch', () => {
    const on = ci.on as {
      push: { 'branches-ignore': string[] };
      pull_request: unknown;
      workflow_dispatch: unknown;
    };
    expect(on.push['branches-ignore']).toEqual(['main']);
    expect('pull_request' in on).toBe(true);
    expect('workflow_dispatch' in on).toBe(true);
  });

  test('the verify job runs install, typecheck, test and build, in that order', () => {
    const steps = ci.jobs.verify.steps;
    const runSteps = steps.filter((s) => typeof s.run === 'string').map((s) => s.run);
    expect(runSteps).toEqual(['npm ci', 'npm run typecheck', 'npm test', 'npm run build']);
  });

  test('checks out the repo and sets up Node 22 before running anything', () => {
    const steps = ci.jobs.verify.steps;
    const usesSteps = steps.filter((s) => typeof s.uses === 'string');
    expect(usesSteps[0]?.uses).toMatch(/^actions\/checkout@/);
    expect(usesSteps[1]?.uses).toMatch(/^actions\/setup-node@/);
    expect(usesSteps[1]?.with?.['node-version']).toBe(22);
  });
});

describe('.github/workflows/release.yml', () => {
  const release = loadWorkflow('release.yml');

  test('parses to a plain object with a name', () => {
    expect(release.name).toBe('Release');
  });

  test('the trigger key was actually found', () => {
    expect(Object.prototype.hasOwnProperty.call(release, 'on')).toBe(true);
    expect(release.on).toBeTruthy();
  });

  test('triggers on push to main and on workflow_dispatch with bump/auth choices', () => {
    const on = release.on as {
      push: { branches: string[] };
      workflow_dispatch: { inputs: Record<string, { type: string; default: string; options: string[] }> };
    };
    expect(on.push.branches).toEqual(['main']);
    expect(on.workflow_dispatch.inputs.bump.options).toEqual(['patch', 'minor', 'major']);
    expect(on.workflow_dispatch.inputs.bump.default).toBe('patch');
    expect(on.workflow_dispatch.inputs.auth.options).toEqual(['oidc', 'token']);
    expect(on.workflow_dispatch.inputs.auth.default).toBe('oidc');
  });

  test('the release job requests contents:write and id-token:write', () => {
    const permissions = release.jobs.release.permissions;
    expect(permissions).toEqual({ contents: 'write', 'id-token': 'write' });
  });

  test('never publishes without first verifying: ci steps precede any publish step', () => {
    const steps = release.jobs.release.steps;
    const names = steps.map((s) => s.name ?? s.run ?? s.uses ?? '');
    const testIdx = steps.findIndex((s) => s.run === 'npm test');
    const publishIdx = steps.findIndex((s) => (s.name ?? '').startsWith('Publish'));
    expect(testIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThan(testIdx);
    expect(names).toContain('Plan');
  });

  test('publishes before pushing the version commit, and releases last', () => {
    const steps = release.jobs.release.steps;
    const publishTokenIdx = steps.findIndex((s) => s.name === 'Publish (token)');
    const publishOidcIdx = steps.findIndex((s) => s.name === 'Publish (OIDC)');
    const pushIdx = steps.findIndex((s) => s.name === 'Push version commit and tag');
    const releaseIdx = steps.findIndex((s) => s.name === 'Create GitHub Release');
    expect(publishTokenIdx).toBeGreaterThanOrEqual(0);
    expect(publishOidcIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeGreaterThan(publishTokenIdx);
    expect(pushIdx).toBeGreaterThan(publishOidcIdx);
    expect(releaseIdx).toBeGreaterThan(pushIdx);
  });

  test('the token publish step carries NODE_AUTH_TOKEN; the OIDC step carries no auth env', () => {
    const steps = release.jobs.release.steps;
    const tokenStep = steps.find((s) => s.name === 'Publish (token)')!;
    const oidcStep = steps.find((s) => s.name === 'Publish (OIDC)')!;
    expect(tokenStep.env?.NODE_AUTH_TOKEN).toBeTruthy();
    expect(oidcStep.env).toBeUndefined();
  });

  test('setup-node is configured twice, gated on auth, and only the token path sets a registry-url', () => {
    const steps = release.jobs.release.steps;
    const setupSteps = steps.filter((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setupSteps.length).toBe(2);
    const tokenSetup = setupSteps.find((s) => s.if?.includes("== 'token'"));
    const otherSetup = setupSteps.find((s) => s.if?.includes("!= 'token'"));
    expect(tokenSetup?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(otherSetup?.with?.['registry-url']).toBeUndefined();
  });
});
