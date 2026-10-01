/**
 * Test doubles for built-in runtimes (NP-219): an AI plugin catalog and connectivity check the test controls, and
 * helpers that enable a built-in runtime and create built-in agents through the real services.
 */
import type { NpServices } from '../../server/modules/services.ts';
import type {
  BuiltinAi,
  BuiltinAiSource,
  BuiltinCatalog,
  BuiltinCheckResult,
} from '../../server/modules/runtime/builtin-ai.ts';
import type { Actor } from '../../server/modules/shared/activity.ts';
import type { AgentCapability } from '../../server/modules/shared/protocol.capabilities.ts';
import type {
  BuiltinAgentEngine,
  BuiltinEngineSource,
  BuiltinRunRequest,
  BuiltinStreamEvent,
  BuiltinUsage,
} from '../../server/modules/builtin/builtin.engine.ts';
import type {
  AgentApi,
  BuiltinToolbox,
  ToolResult,
} from '../../server/modules/builtin/builtin.toolbox.ts';
import {
  createAgentApiRoutes,
  runTokenAuth,
} from '../../server/modules/run/agent-api.routes.ts';
import { guarded } from '../../server/modules/shared/http.ts';
import { inProcessAgentApi } from '../../server/providers/np-builtin-agent.ts';

export interface FakeAi {
  /** null: the plugin is not registered. */
  present: boolean;
  catalog: BuiltinCatalog;
  check: BuiltinCheckResult;
  readonly checks: { llmService: string; model: string }[];
  readonly source: BuiltinAiSource;
}

export const DEEPSEEK = {
  llmService: 'deepseek',
  title: 'DeepSeek',
  provider: 'deepseek',
  enabledModels: [
    { label: 'DeepSeek Flash', value: 'deepseek-flash' },
    { label: 'DeepSeek Pro', value: 'deepseek-pro' },
  ],
} as const;

export function fakeAi(): FakeAi {
  const fake: FakeAi = {
    present: true,
    catalog: {
      services: [
        { name: 'deepseek', title: 'DeepSeek', provider: 'deepseek' },
        { name: 'idle', title: 'Idle', provider: 'openai' },
      ],
      enabled: [
        DEEPSEEK,
        {
          llmService: 'idle',
          title: 'Idle',
          provider: 'openai',
          enabledModels: [],
        },
      ],
    },
    check: { ok: true, message: null },
    checks: [],
    source: () => (fake.present ? ai : null),
  };
  const ai: BuiltinAi = {
    catalog: async () => fake.catalog,
    testFlight: async (llmService, model) => {
      fake.checks.push({ llmService, model });
      return fake.check;
    },
  };
  return fake;
}

/** Enables `llmService` as a built-in runtime (the actor must be an owner / admin). */
export async function enableBuiltin(
  services: NpServices,
  admin: Actor,
  llmService = 'deepseek',
): Promise<string> {
  const { runtime } = await services.runtimes.enableBuiltin(admin, {
    llmService,
  });
  return runtime.id;
}

export async function createBuiltinAgent(
  services: NpServices,
  owner: Actor,
  runtimeId: string,
  options: {
    readonly name?: string;
    readonly kind?: 'coder' | 'manager';
    readonly capabilities?: readonly AgentCapability[];
    readonly model?: string | null;
    readonly access?: 'ownerOnly' | 'specificUsers' | 'everyone';
  } = {},
): Promise<string> {
  const agent = await services.agents.create(owner, {
    name: options.name ?? 'Helper',
    instructions: 'Answer questions about the project.',
    runtimeId,
    runtimeType: 'builtin',
    provider: 'nocobase-ai',
    model: options.model ?? null,
    kind: options.kind ?? 'coder',
    access: options.access ?? 'everyone',
    capabilities: options.capabilities ?? ['context.read', 'comment.create'],
  });
  return agent.id;
}

// ---------- Built-in runs (protocol-runtime-types.md §6) ----------

export interface ScriptContext {
  readonly request: BuiltinRunRequest;
  /** Calls one of the run's tools as the plugin would. */
  tool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
}

export type Script = (
  context: ScriptContext,
) => AsyncGenerator<BuiltinStreamEvent, void, void>;

export interface FakeEngine {
  script: Script;
  usage: BuiltinUsage;
  readonly sessions: { userId: string; title: string; sessionId: string }[];
  readonly requests: BuiltinRunRequest[];
  readonly results: ToolResult[];
  readonly source: BuiltinEngineSource;
}

/** Rejects like the plugin when the run's signal fires. */
export function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () =>
      reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

export function fakeEngine(toolbox: () => BuiltinToolbox): FakeEngine {
  let next = 0;
  const fake: FakeEngine = {
    script: async function* () {
      yield { type: 'content', content: 'Done.' };
    },
    usage: {
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 10,
      reported: true,
    },
    sessions: [],
    requests: [],
    results: [],
    source: () => engine,
  };
  const engine: BuiltinAgentEngine = {
    async createSession({ userId, title }) {
      next += 1;
      const sessionId = `session-${next}`;
      fake.sessions.push({ userId, title, sessionId });
      return sessionId;
    },
    run(request) {
      fake.requests.push(request);
      return fake.script({
        request,
        tool: async (name, args = {}) => {
          const result = await toolbox().invoke(request.sessionId, name, args);
          fake.results.push(result);
          return result;
        },
      });
    },
    usage: async () => fake.usage,
  };
  return fake;
}

/** The agent API router a daemon's CLI calls, in process (the routes the built-in tools need). */
export function testAgentApi(services: NpServices): AgentApi {
  const router = guarded(
    [runTokenAuth(services.runTokens)],
    createAgentApiRoutes({
      issues: services.issues,
      queries: services.issueQueries,
      comments: services.comments,
      agentIssues: services.agentIssues,
      pullRequests: services.pullRequests,
    }),
  );
  return inProcessAgentApi(() => router as never);
}
