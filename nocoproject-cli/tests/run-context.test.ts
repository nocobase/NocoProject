import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentEnv } from '../src/daemon/env.js';
import { checkoutExtras } from '../src/daemon/runner.js';
import { buildRunContext, findWorkDir, readCheckoutRecord, readRunContext, writeCheckoutRecord, writeRunContext } from '../src/run-context.js';
import { claimedRun, phase1Run } from './helpers/fixtures.js';

describe('run context', () => {
  it('fills defaults for a Phase 0 claim payload', () => {
    expect(buildRunContext(claimedRun())).toEqual({
      version: 1,
      runId: '7301234567890123',
      agent: { id: 'a1', name: 'Coder', delegationTargets: [] },
      issue: { id: 'i12', identifier: 'NP-12', title: 'Fix login redirect', parent: null, stage: null, autoExecuteSubtasks: false, projectId: null },
      project: null,
      session: { branchName: null, repoUrl: null },
    });
  });

  it('carries the Phase 1 extras and never the run token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ncp-ctx-'));
    const run = phase1Run();
    const path = writeRunContext(dir, run);
    const ctx = readRunContext(dir);
    expect(ctx).toMatchObject({ project: run.project, issue: { stage: 2, autoExecuteSubtasks: true, parent: { identifier: 'NP-10' } }, session: { branchName: 'agent/coder/np-12' } });
    expect(JSON.stringify(ctx)).not.toContain(run.token);
    expect(path).toBe(join(dir, '.nocoproject', 'context.json'));
  });

  it('finds the workDir from the env or by walking up from cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ncp-find-'));
    writeRunContext(dir, claimedRun());
    const nested = join(dir, 'repo', 'src');
    mkdirSync(nested, { recursive: true });
    expect(findWorkDir({}, nested)).toBe(dir);
    expect(findWorkDir({ NOCOPROJECT_WORKDIR: '/elsewhere' }, nested)).toBe('/elsewhere');
    expect(findWorkDir({}, tmpdir())).toBeNull();
  });

  it('reads checkout.json back into complete/fail extras', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ncp-co-'));
    expect(checkoutExtras(dir)).toEqual({});
    writeCheckoutRecord(dir, { url: 'https://x/y.git', ref: 'main', branchName: 'agent/a/np-1', path: join(dir, 'y') });
    expect(checkoutExtras(dir)).toEqual({ branchName: 'agent/a/np-1', repoUrl: 'https://x/y.git' });
    writeFileSync(join(dir, '.nocoproject', 'checkout.json'), '{"url":""}');
    expect(readCheckoutRecord(dir)).toBeNull();
  });

  it('injects NOCOPROJECT_WORKDIR and NOCOPROJECT_HOME into the agent env', () => {
    const env = buildAgentEnv({ serverUrl: 'http://s/main', token: 'npr_x', claimed: claimedRun(), workDir: '/w', home: '/h' });
    expect(env).toMatchObject({ NOCOPROJECT_WORKDIR: '/w', NOCOPROJECT_HOME: '/h', NOCOPROJECT_ISSUE_KEY: 'NP-12' });
    expect(env.NOCOPROJECT_API_KEY).toBeUndefined();
  });
});
