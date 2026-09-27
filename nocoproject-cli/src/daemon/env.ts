/**
 * Per-run execution environment: `<root>/<issueKey>-<runKey>/{workdir,logs}`.
 * A previous session's workDir is reused when the server hands it back, it still
 * exists, and the session is not marked fresh.
 */
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { ClaimedRun } from '../protocol.js';
import { RUN_ENV } from '../protocol.js';

export interface RunEnvironment {
  readonly envDir: string;
  readonly workDir: string;
  readonly logsDir: string;
  readonly reused: boolean;
  readonly resumeSessionId?: string;
}

function safeSegment(value: string, max = 40): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'x').slice(0, max);
}

export function envDirName(issueKey: string, runId: string): string {
  return `${safeSegment(issueKey)}-${safeSegment(runId.slice(-12), 12)}`;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function prepareRunEnvironment(root: string, claimed: Pick<ClaimedRun, 'run' | 'issue' | 'session'>, canResume: boolean): RunEnvironment {
  const envDir = join(root, envDirName(claimed.issue.identifier, claimed.run.id));
  const logsDir = join(envDir, 'logs');
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  const prior = claimed.session.workDir;
  const reuse = !claimed.session.fresh && !!prior && isDirectory(prior);
  const workDir = reuse ? (prior as string) : join(envDir, 'workdir');
  mkdirSync(workDir, { recursive: true });
  const resumeSessionId =
    reuse && canResume && !claimed.session.fresh && claimed.session.providerSessionId ? claimed.session.providerSessionId : undefined;
  return { envDir, workDir, logsDir, reused: reuse, resumeSessionId };
}

/**
 * Writes `<home>/bin/nocoproject` (and `ncp`) pointing at the CLI bundle so agents can run
 * `nocoproject ...` even when the package is not installed globally. Returns the bin dir.
 */
export function ensureCliShim(home: string, cliPath: string): string {
  const binDir = join(home, 'bin');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const script = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`;
  for (const name of ['nocoproject', 'ncp']) {
    const path = join(binDir, name);
    writeFileSync(path, script, { mode: 0o755 });
    chmodSync(path, 0o755);
  }
  return binDir;
}

export interface AgentEnvInput {
  readonly serverUrl: string;
  readonly token: string;
  readonly claimed: Pick<ClaimedRun, 'run' | 'agent' | 'issue'>;
  readonly binDir?: string;
}

/** Environment injected into the agent process (§7). */
export function buildAgentEnv(input: AgentEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    [RUN_ENV.serverUrl]: input.serverUrl,
    [RUN_ENV.token]: input.token,
    [RUN_ENV.runId]: input.claimed.run.id,
    [RUN_ENV.agentId]: input.claimed.agent.id,
    [RUN_ENV.issueId]: input.claimed.issue.id,
    [RUN_ENV.issueKey]: input.claimed.issue.identifier,
  };
  if (input.binDir && existsSync(input.binDir)) env.PATH = `${input.binDir}${delimiter}${process.env.PATH ?? ''}`;
  return env;
}
