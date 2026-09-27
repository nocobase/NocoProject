/**
 * Per-run context files under `<workDir>/.nocoproject/` (contract §I):
 *
 * - `context.json` — written by the daemon (mode 0600) before the tool starts, from the Phase 1
 *   claim extras: project and its repositories, parent issue, stage, delegation targets and the
 *   previous session's branch. The agent CLI reads it offline (`repo checkout`, `project get`).
 *   It never contains the run token.
 * - `checkout.json` — written by `nocoproject repo checkout`; the daemon reads it back and reports
 *   `branchName` / `repoUrl` on complete / fail.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  CheckoutRecord,
  ClaimedProject,
  ClaimedRun,
  ClaimedRunPhase1Extras,
  ClaimedTriggerComment,
  Phase1RunTriggerType,
} from './protocol.js';
import { RUN_ENV_PHASE1 } from './protocol.js';

/**
 * A claimed run as the Phase 1 server sends it: the Phase 0 payload plus the iteration-1 extras.
 * Every extra is optional so a Phase 0 server (or an older mock) still type-checks and works.
 */
export type ClaimedRunV1 = Omit<ClaimedRun, 'issue' | 'agent' | 'session' | 'triggers'> & {
  readonly project?: ClaimedProject | null;
  readonly issue: ClaimedRun['issue'] & Partial<ClaimedRunPhase1Extras['issue']>;
  readonly agent: ClaimedRun['agent'] & Partial<ClaimedRunPhase1Extras['agent']>;
  readonly session: ClaimedRun['session'] & Partial<ClaimedRunPhase1Extras['session']>;
  readonly triggers: readonly { readonly type: Phase1RunTriggerType; readonly comment?: ClaimedTriggerComment }[];
};

export interface RunContextFile {
  readonly version: 1;
  readonly runId: string;
  readonly agent: {
    readonly id: string;
    readonly name: string;
    readonly delegationTargets: readonly { readonly id: string; readonly name: string }[];
  };
  readonly issue: {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly parent: { readonly id: string; readonly identifier: string; readonly title: string } | null;
    readonly stage: number | null;
    readonly autoExecuteSubtasks: boolean;
    readonly projectId: string | null;
  };
  readonly project: ClaimedProject | null;
  readonly session: { readonly branchName: string | null; readonly repoUrl: string | null };
}

export const CONTEXT_DIR = '.nocoproject';
export const CONTEXT_FILE = 'context.json';
export const CHECKOUT_FILE = 'checkout.json';

export function buildRunContext(claimed: ClaimedRunV1): RunContextFile {
  return {
    version: 1,
    runId: claimed.run.id,
    agent: { id: claimed.agent.id, name: claimed.agent.name, delegationTargets: claimed.agent.delegationTargets ?? [] },
    issue: {
      id: claimed.issue.id,
      identifier: claimed.issue.identifier,
      title: claimed.issue.title,
      parent: claimed.issue.parent ?? null,
      stage: claimed.issue.stage ?? null,
      autoExecuteSubtasks: claimed.issue.autoExecuteSubtasks ?? false,
      projectId: claimed.issue.projectId ?? claimed.project?.id ?? null,
    },
    project: claimed.project ?? null,
    session: { branchName: claimed.session.branchName ?? null, repoUrl: claimed.session.repoUrl ?? null },
  };
}

function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Writes `<workDir>/.nocoproject/context.json` (0600). Returns the path. */
export function writeRunContext(workDir: string, claimed: ClaimedRunV1): string {
  const path = join(workDir, CONTEXT_DIR, CONTEXT_FILE);
  writePrivateJson(path, buildRunContext(claimed));
  return path;
}

export function readRunContext(workDir: string): RunContextFile | null {
  const ctx = readJson<RunContextFile>(join(workDir, CONTEXT_DIR, CONTEXT_FILE));
  return ctx && typeof ctx === 'object' && ctx.issue && ctx.agent ? ctx : null;
}

export function writeCheckoutRecord(workDir: string, record: CheckoutRecord): string {
  const path = join(workDir, CONTEXT_DIR, CHECKOUT_FILE);
  writePrivateJson(path, record);
  return path;
}

/** Reads `checkout.json`; returns null when missing or malformed. */
export function readCheckoutRecord(workDir: string): CheckoutRecord | null {
  const rec = readJson<CheckoutRecord>(join(workDir, CONTEXT_DIR, CHECKOUT_FILE));
  if (!rec || typeof rec.url !== 'string' || typeof rec.branchName !== 'string' || !rec.url || !rec.branchName) return null;
  return rec;
}

/**
 * The run's workDir as seen by the agent CLI: `$NOCOPROJECT_WORKDIR`, otherwise the nearest
 * ancestor of `cwd` that contains `.nocoproject/context.json`.
 */
export function findWorkDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | null {
  const fromEnv = env[RUN_ENV_PHASE1.workDir];
  if (fromEnv) return resolve(fromEnv);
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, CONTEXT_DIR, CONTEXT_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
