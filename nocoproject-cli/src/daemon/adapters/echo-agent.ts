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

  const parent = prompt.match(/--parent\s+([A-Za-z0-9_-]+)/)?.[1];
  const trigger = prompt.match(/^> (.*)$/m)?.[1];
  const reply = [
    `Echo agent report: handled ${issue.identifier ?? issueKey} "${issue.title ?? ''}".`,
    '',
    trigger ? `You said: ${trigger}` : 'No trigger comment in this turn.',
    '',
    `Run: ${process.env.NOCOPROJECT_RUN_ID ?? 'unknown'}`,
  ].join('\n');
  writeFileSync(join(process.cwd(), 'reply.md'), `${reply}\n`);
  const commentArgs = ['issue', 'comment', 'add', issueKey, '--content-file', 'reply.md', '--json'];
  if (parent) commentArgs.push('--parent', parent);
  const commented = cli(commentArgs);
  if (!commented.ok) fail(`echo agent: comment add failed: ${commented.output}`);

  if (status === 'in_progress') {
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
