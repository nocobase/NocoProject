/**
 * The `np_*` tools at run time (NP-219, protocol-runtime-types.md §6.5). The AI plugin calls a tool with the plugin
 * session id of the conversation; this maps it to the active built-in run of that session and makes the tool's agent
 * API request in process with the run's token, so `requireCapability` (the agent's capabilities ∩ the caller's
 * permissions, an active run, the visible issue), `ISSUE_NOT_IN_RUN`, the transition matrix, the design gate, entry
 * conditions and approval gates apply exactly as for a daemon's CLI. No second permission model exists here.
 *
 * Tokens stay in this process: never in a prompt, an event or a tool result. A session with no active run (the run
 * ended, or someone continues the conversation in the plugin's chat) is refused. Each call writes a `toolUse` and a
 * `toolResult` run event.
 */
import type { ClaimedSkill, RunEventType } from '../shared/protocol.js';
import { toolSpec, type AgentApiRequest } from './builtin.tools.js';

/** Results above this are cut (and say so), so one large read does not fill the model's context. */
export const TOOL_RESULT_MAX_BYTES = 32 * 1024;

export interface AgentApiResponse {
  readonly status: number;
  readonly body: unknown;
}

/** The agent API (`/np/agent/*`), called in process with a run token. */
export interface AgentApi {
  request(token: string, request: AgentApiRequest): Promise<AgentApiResponse>;
}

export interface RunEventDraft {
  readonly type: RunEventType;
  readonly tool?: string;
  readonly content?: string;
  readonly input?: unknown;
  readonly output?: string;
}

export interface ActiveBuiltinRun {
  readonly runId: string;
  readonly token: string;
  /** The run's issue for tools that default to it (identifier, or id for a conversation). */
  readonly issue: string;
  readonly tools: ReadonlySet<string>;
  readonly skills: readonly ClaimedSkill[];
  record(events: readonly RunEventDraft[]): Promise<void>;
}

export interface ToolResult {
  readonly status: 'success' | 'error';
  readonly content: string;
}

export interface BuiltinToolbox {
  attach(sessionId: string, run: ActiveBuiltinRun): void;
  detach(sessionId: string): void;
  invoke(
    sessionId: string | undefined,
    tool: string,
    args: unknown,
  ): Promise<ToolResult>;
}

function clip(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= TOOL_RESULT_MAX_BYTES) return text;
  let end = TOOL_RESULT_MAX_BYTES;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}\n[truncated: the result was ${bytes.length} bytes; narrow the request]`;
}

function errorOf(body: unknown, status: number): string {
  const value = body as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code : `HTTP_${status}`;
  const message = typeof value?.message === 'string' ? value.message : '';
  return `${code}: ${message}`.trim();
}

function skillFile(
  run: ActiveBuiltinRun,
  args: Record<string, unknown>,
): ToolResult {
  const skill = run.skills.find((item) => item.slug === args.skill);
  const file = skill?.files.find((item) => item.path === args.path);
  if (!skill)
    return {
      status: 'error',
      content: `NOT_FOUND: no skill ${String(args.skill)}`,
    };
  if (!file)
    return {
      status: 'error',
      content: `NOT_FOUND: ${String(args.path)} is not a file of ${skill.slug} (files: ${skill.files.map((item) => item.path).join(', ') || 'none'})`,
    };
  return { status: 'success', content: clip(file.content) };
}

async function call(
  api: AgentApi,
  run: ActiveBuiltinRun,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const spec = toolSpec(tool);
  if (!spec || !run.tools.has(tool))
    return {
      status: 'error',
      content: `CAPABILITY_DENIED: ${tool} is not available to this run`,
    };
  const parsed = spec.schema.safeParse(args ?? {});
  if (!parsed.success)
    return {
      status: 'error',
      content: `INVALID_ARGUMENTS: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`,
    };
  const values = parsed.data;
  const request = spec.request(values, { issue: run.issue });
  if (request === 'local') return skillFile(run, values);
  const response = await api.request(run.token, request);
  if (response.status === 202)
    return {
      status: 'success',
      content: clip(
        JSON.stringify({ pending: true, ...(response.body as object) }),
      ),
    };
  if (response.status >= 200 && response.status < 300) {
    const body = response.body as { data?: unknown } | null;
    return {
      status: 'success',
      content: clip(JSON.stringify(body && 'data' in body ? body.data : body)),
    };
  }
  return {
    status: 'error',
    content: clip(errorOf(response.body, response.status)),
  };
}

/** `api` is resolved per call: the provider builds the router after the services. */
export function createBuiltinToolbox(api: () => AgentApi): BuiltinToolbox {
  const sessions = new Map<string, ActiveBuiltinRun>();
  return {
    attach: (sessionId, run) => void sessions.set(sessionId, run),
    detach: (sessionId) => void sessions.delete(sessionId),
    async invoke(sessionId, tool, args) {
      const run = sessionId ? sessions.get(sessionId) : undefined;
      if (!run)
        return {
          status: 'error',
          content: 'CAPABILITY_DENIED: not inside an active NocoProject run',
        };
      const input = (args ?? {}) as Record<string, unknown>;
      let result: ToolResult;
      try {
        result = await call(api(), run, tool, input);
      } catch (error) {
        result = {
          status: 'error',
          content: `INTERNAL_ERROR: ${(error as Error)?.message ?? String(error)}`,
        };
      }
      await run
        .record([
          { type: 'toolUse', tool, input },
          {
            type: 'toolResult',
            tool,
            output:
              result.status === 'error'
                ? `[error] ${result.content}`
                : result.content,
          },
        ])
        .catch(() => undefined);
      return result;
    },
  };
}
