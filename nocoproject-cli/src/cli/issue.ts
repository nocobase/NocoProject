/**
 * Agent-facing commands (run-token mode): issue get / comment list / comment add / status.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';
import { AgentApi } from '../api/client.js';
import { normalizeServerUrl } from '../config.js';
import type { CommentForAgent, IssueForAgent } from '../protocol.js';
import { RUN_ENV } from '../protocol.js';
import { registerSecret } from '../util/redact.js';
import { CliError, EXIT, failAndExit, printJson, printLine } from './output.js';

export interface RunTokenContext {
  readonly api: AgentApi;
  readonly issueId?: string;
  readonly issueKey?: string;
}

export function runTokenContext(env: NodeJS.ProcessEnv = process.env): RunTokenContext {
  const token = env[RUN_ENV.token];
  const serverUrl = env[RUN_ENV.serverUrl];
  if (!token || !serverUrl) {
    throw new CliError(
      `issue commands run inside an agent run: ${RUN_ENV.token} and ${RUN_ENV.serverUrl} must be set`,
      EXIT.auth,
      'RUN_TOKEN_REQUIRED',
    );
  }
  registerSecret(token);
  return { api: new AgentApi(normalizeServerUrl(serverUrl), token), issueId: env[RUN_ENV.issueId], issueKey: env[RUN_ENV.issueKey] };
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Resolves `NP-12` style identifiers to ids; raw ids pass through. */
export async function resolveIssueId(arg: string | undefined, ctx: RunTokenContext): Promise<string> {
  if (!arg) {
    if (ctx.issueId) return ctx.issueId;
    throw new CliError('issue id or identifier is required', EXIT.validation, 'ISSUE_REQUIRED');
  }
  if (!IDENTIFIER.test(arg)) return arg;
  if (ctx.issueKey && ctx.issueId && ctx.issueKey.toUpperCase() === arg.toUpperCase()) return ctx.issueId;
  const context = await ctx.api.context();
  if (context.issue.identifier.toUpperCase() === arg.toUpperCase()) return context.issue.id;
  return arg;
}

function printIssue(issue: IssueForAgent): void {
  printLine(`${issue.identifier}  ${issue.title}`);
  printLine(`status: ${issue.statusKey}   priority: ${issue.priority}   owner: ${issue.ownerName}`);
  printLine(`executor: ${issue.executor.type}${issue.executor.name ? ` (${issue.executor.name})` : ''}`);
  printLine();
  printLine(issue.description || '(no description)');
}

function printComments(comments: readonly CommentForAgent[]): void {
  if (comments.length === 0) return printLine('(no comments)');
  for (const c of comments) {
    const reply = c.parentId ? ` ↳ reply in thread ${c.rootId}` : ` (thread root)`;
    printLine(`--- [${c.id}] ${c.authorName} (${c.authorType}) ${c.createdAt}${reply}`);
    printLine(c.content);
  }
}

const CommentAddInput = z
  .object({
    content: z.string().optional(),
    contentFile: z.string().optional(),
    parent: z.string().min(1).optional(),
  })
  .refine((v) => (v.content === undefined) !== (v.contentFile === undefined), {
    message: 'pass exactly one of --content or --content-file',
  });

function readContent(opts: { content?: string; contentFile?: string }): string {
  let content = opts.content;
  if (opts.contentFile !== undefined) {
    const path = resolve(opts.contentFile);
    if (!existsSync(path)) throw new CliError(`content file not found: ${path}`, EXIT.validation, 'FILE_NOT_FOUND');
    content = readFileSync(path, 'utf8');
  }
  if (!content || !content.trim()) throw new CliError('comment content is empty', EXIT.validation, 'EMPTY_CONTENT');
  return content;
}

type JsonOpt = { json?: boolean };

function action<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    const cmd = args[args.length - 1] as Command;
    const json = Boolean((cmd.optsWithGlobals() as JsonOpt).json);
    try {
      await fn(...args);
    } catch (error) {
      failAndExit(error, json);
    }
  };
}

export function registerIssueCommands(program: Command): void {
  const issue = program.command('issue').description('Read and update the issue of the current agent run (run-token mode)');

  issue
    .command('get [issue]')
    .description('Show an issue (defaults to the run’s issue)')
    .option('--json', 'JSON output')
    .action(
      action(async (arg: string | undefined, opts: JsonOpt) => {
        const ctx = runTokenContext();
        const data = await ctx.api.issue(await resolveIssueId(arg, ctx));
        if (opts.json) printJson(data);
        else printIssue(data);
      }),
    );

  const comment = issue.command('comment').description('Issue comments');
  comment
    .command('list [issue]')
    .description('List comments')
    .option('--since <iso>', 'only comments created after this time')
    .option('--thread <rootId>', 'only one thread')
    .option('--tail <n>', 'only the last n comments', (v) => z.coerce.number().int().positive().parse(v))
    .option('--roots-only', 'only thread roots')
    .option('--json', 'JSON output')
    .action(
      action(async (arg: string | undefined, opts: JsonOpt & { since?: string; thread?: string; tail?: number; rootsOnly?: boolean }) => {
        const ctx = runTokenContext();
        const data = await ctx.api.comments(await resolveIssueId(arg, ctx), opts);
        if (opts.json) printJson(data);
        else printComments(data ?? []);
      }),
    );
  comment
    .command('add [issue]')
    .description('Post a comment as the agent')
    .option('--content-file <path>', 'read the Markdown body from a file (preferred)')
    .option('--content <text>', 'inline Markdown body')
    .option('--parent <commentId>', 'reply inside this thread')
    .option('--json', 'JSON output')
    .action(
      action(async (arg: string | undefined, raw: JsonOpt & { content?: string; contentFile?: string; parent?: string }) => {
        const opts = CommentAddInput.parse(raw);
        const content = readContent(opts);
        const ctx = runTokenContext();
        const data = await ctx.api.addComment(await resolveIssueId(arg, ctx), content, opts.parent);
        if (raw.json) printJson(data);
        else printLine('comment posted');
      }),
    );

  issue
    .command('status <issueOrStatus> [statusKey]')
    .description('Change the status: `status <statusKey>` (run’s issue) or `status <issue> <statusKey>`')
    .option('--json', 'JSON output')
    .action(
      action(async (first: string, second: string | undefined, opts: JsonOpt) => {
        const ctx = runTokenContext();
        const [arg, key] = second === undefined ? [undefined, first] : [first, second];
        const statusKey = z.string().regex(/^[a-z][a-z0-9_]*$/, 'invalid status key').parse(key);
        const data = await ctx.api.setStatus(await resolveIssueId(arg, ctx), statusKey);
        if (opts.json) printJson(data ?? { ok: true, statusKey });
        else printLine(`status set to ${statusKey}`);
      }),
    );
}
