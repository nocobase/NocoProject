/**
 * nocoproject-echo-agent: a scripted stand-in for a coding agent, used in automated e2e tests.
 *
 * Reads the per-turn prompt from argv, then does what a real agent is told to do, using the
 * real CLI in run-token mode: `issue get`, `issue status in_progress`, write reply.md,
 * `issue comment add --content-file reply.md [--parent <rootId>]`, `issue status in_review`.
 * Prints NDJSON events (text / tool_use / tool_result / result) on stdout.
 *
 * Test directives may appear in the issue title or description:
 *   [echo:sleep=<ms>]   pause before replying (to test cancellation / watchdogs)
 *   [echo:fail=<text>]  print <text> to stderr and exit 1 (to test failure classification)
 *   [echo:subtasks=<n>] create n sub-issues with `issue create --executor self --stage <i>` and keep
 *                       the parent in_progress (as the brief tells a coordinating agent to). On a later
 *                       turn the sub-issues already exist, so the agent does not split again: it writes
 *                       in_review once every child is done, otherwise it keeps waiting.
 *   [echo:checkout=<url>] run `repo checkout <url> --json`, write a file in the worktree and commit it
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let callSeq = 0;

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

interface CliResult {
  readonly ok: boolean;
  readonly json: unknown;
  readonly output: string;
}

function cli(args: string[]): CliResult {
  const id = `call_${++callSeq}`;
  emit({ type: 'tool_use', id, name: 'shell', input: { command: `nocoproject ${args.join(' ')}` } });
  const cliPath = process.env.NOCOPROJECT_CLI_PATH;
  const proc = cliPath
    ? spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env: process.env })
    : spawnSync('nocoproject', args, { encoding: 'utf8', env: process.env });
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim();
  const ok = proc.status === 0;
  emit({ type: 'tool_result', id, output: output.slice(0, 4000), is_error: !ok });
  let json: unknown = undefined;
  try {
    json = JSON.parse(proc.stdout ?? '');
  } catch {
    json = undefined;
  }
  return { ok, json, output };
}

function shell(command: string, args: string[], cwd: string): CliResult {
  const id = `call_${++callSeq}`;
  emit({ type: 'tool_use', id, name: 'shell', input: { command: `${command} ${args.join(' ')}` } });
  const proc = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim();
  const ok = proc.status === 0;
  emit({ type: 'tool_result', id, output: output.slice(0, 4000), is_error: !ok });
  return { ok, json: undefined, output };
}

interface ChildSummary {
  readonly identifier?: string;
  readonly statusKey?: string;
}

/** The existing sub-issues of `issueKey`, via `issue children --json`. */
function listChildren(issueKey: string): ChildSummary[] {
  const r = cli(['issue', 'children', issueKey, '--json']);
  if (!r.ok) fail(`echo agent: issue children failed: ${r.output}`);
  const data = r.json as ChildSummary[] | { children?: ChildSummary[]; data?: ChildSummary[] } | undefined;
  if (Array.isArray(data)) return data;
  return data?.children ?? data?.data ?? [];
}

const TERMINAL = new Set(['done', 'closed', 'cancelled', 'canceled']);

/** Creates `count` staged sub-issues executed by this agent. Returns their identifiers. */
function createSubtasks(issueKey: string, count: number): string[] {
  const created: string[] = [];
  for (let i = 1; i <= count; i++) {
    const r = cli(['issue', 'create', '--title', `Part ${i} of ${issueKey}`, '--description', `Created by the echo agent for ${issueKey}.`, '--executor', 'self', '--stage', String(i), '--json']);
    if (!r.ok) fail(`echo agent: issue create failed: ${r.output}`);
    const data = r.json as { identifier?: string; id?: string; issue?: { identifier?: string; id?: string } } | undefined;
    const issue = data?.issue ?? data;
    created.push(issue?.identifier ?? issue?.id ?? `sub-${i}`);
  }
  return created;
}

/** Checks out `url`, writes a file on the agent branch and commits it. Returns the branch. */
function checkoutAndCommit(issueKey: string, url: string): string {
  const r = cli(['repo', 'checkout', url, '--json']);
  if (!r.ok) fail(`echo agent: repo checkout failed: ${r.output}`);
  const rec = r.json as { path: string; branchName: string };
  const runId = process.env.NOCOPROJECT_RUN_ID ?? 'run';
  writeFileSync(join(rec.path, `echo-${runId}.md`), `Echo agent was here for ${issueKey} (run ${runId}).\n`);
  if (!shell('git', ['add', '-A'], rec.path).ok) fail('echo agent: git add failed');
  const commit = shell('git', ['commit', '-q', '-m', `${issueKey}: echo agent change (run ${runId})`], rec.path);
  if (!commit.ok) fail(`echo agent: git commit failed: ${commit.output}`);
  return rec.branchName;
}

function directive(text: string, name: string): string | undefined {
  return text.match(new RegExp(`\\[echo:${name}=([^\\]]*)\\]`))?.[1];
}

function fail(message: string): never {
  emit({ type: 'error', message });
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const prompt = process.argv[2] ?? '';
  const issueKey = process.env.NOCOPROJECT_ISSUE_KEY ?? process.env.NOCOPROJECT_ISSUE_ID;
  if (!issueKey || !process.env.NOCOPROJECT_TOKEN) fail('echo agent: run-token environment is missing');
  emit({ type: 'text', text: `Echo agent received a ${prompt.length}-character prompt for ${issueKey}.` });

  const got = cli(['issue', 'get', issueKey, '--json']);
  if (!got.ok) fail(`echo agent: issue get failed: ${got.output}`);
  const issue = got.json as { identifier?: string; title?: string; description?: string; statusKey?: string };
  const text = `${issue.title ?? ''}\n${issue.description ?? ''}`;

  const failWith = directive(text, 'fail');
  if (failWith) fail(failWith);
  const sleepMs = Number(directive(text, 'sleep') ?? 0);
  if (sleepMs > 0) {
    emit({ type: 'text', text: `Sleeping ${sleepMs}ms as requested.` });
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  let status = issue.statusKey;
  if (status === 'todo' || status === 'blocked') {
    const moved = cli(['issue', 'status', issueKey, 'in_progress', '--json']);
    if (!moved.ok) fail(`echo agent: status in_progress failed: ${moved.output}`);
    status = 'in_progress';
  }

  const extra: string[] = [];
  const checkoutUrl = directive(text, 'checkout');
  if (checkoutUrl) extra.push(`Committed on branch ${checkoutAndCommit(issueKey, checkoutUrl)}.`);
  const subtaskCount = Number(directive(text, 'subtasks') ?? 0);
  let coordinating = false;
  if (subtaskCount > 0) {
    const existing = listChildren(issueKey);
    if (existing.length === 0) {
      extra.push(`Created sub-issues: ${createSubtasks(issueKey, subtaskCount).join(', ')}.`);
      coordinating = true;
    } else if (existing.some((c) => !TERMINAL.has(c.statusKey ?? ''))) {
      extra.push(`Waiting on sub-issues: ${existing.map((c) => `${c.identifier ?? '?'} (${c.statusKey ?? '?'})`).join(', ')}.`);
      coordinating = true;
    } else {
      extra.push(`All ${existing.length} sub-issues are done; handing the parent over for review.`);
    }
  }

  const parent = prompt.match(/--parent\s+([A-Za-z0-9_-]+)/)?.[1];
  const trigger = prompt.match(/^> (.*)$/m)?.[1];
  const reply = [
    `Echo agent report: handled ${issue.identifier ?? issueKey} "${issue.title ?? ''}".`,
    '',
    trigger ? `You said: ${trigger}` : 'No trigger comment in this turn.',
    ...(extra.length ? ['', ...extra] : []),
    '',
    `Run: ${process.env.NOCOPROJECT_RUN_ID ?? 'unknown'}`,
  ].join('\n');
  writeFileSync(join(process.cwd(), 'reply.md'), `${reply}\n`);
  const commentArgs = ['issue', 'comment', 'add', issueKey, '--content-file', 'reply.md', '--json'];
  if (parent) commentArgs.push('--parent', parent);
  const commented = cli(commentArgs);
  if (!commented.ok) fail(`echo agent: comment add failed: ${commented.output}`);

  if (status === 'in_progress' && !coordinating) {
    const reviewed = cli(['issue', 'status', issueKey, 'in_review', '--json']);
    if (!reviewed.ok) fail(`echo agent: status in_review failed: ${reviewed.output}`);
  }

  const summary = `Echo agent delivered a reply on ${issue.identifier ?? issueKey}.`;
  emit({ type: 'text', text: summary });
  emit({
    type: 'result',
    session_id: `echo-${process.env.NOCOPROJECT_RUN_ID ?? 'session'}`,
    text: summary,
    usage: { inputTokens: prompt.length, outputTokens: reply.length },
  });
}

main().catch((error: unknown) => fail(`echo agent crashed: ${(error as Error).message}`));
