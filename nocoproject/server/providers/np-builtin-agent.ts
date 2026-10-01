/**
 * NP-219: built-in agent runs on the NocoBase AI plugin's public server API only (protocol-runtime-types.md §6, §11.1,
 * ADR-0010):
 *
 * - the engine (`BuiltinAgentEngine`): `aiConversationsManagerToken.create` / `getMessages` for the run's conversation
 *   and its usage, `agentServiceFactoryToken.createAgent(...).stream()` for the run, with a process-local checkpointer;
 * - the `np_*` tools, registered through an `AIResourceRegistrar` (scope `SPECIFIED`, so no AI employee gets them by
 *   default; backend; `ALLOW`, because nobody is there to approve), each forwarding to the tool box;
 * - the agent API the tool box calls: the real `/np/agent` router (`createNpAgentRouter`), in process.
 *
 * Nothing here reads or writes the plugin's tables or deep-imports its files.
 */
import {
  agentServiceFactoryToken,
  aiConversationsManagerToken,
  aiManagerToken,
  AIResourceRegistrar,
} from '@nocobase/app-plugin-ai-employee/server';
import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import type { AIEmployeeManager, ToolsManager } from '@nocobase/ai-employee';
import type { Hono } from 'hono';

import type { NocoProjectConfig } from '../config/nocoproject.js';
import type { BuiltinExecutorConfig } from '../modules/builtin/builtin.executor.js';
import type { NpServiceDeps, NpServices } from '../modules/services.js';
import { aiModelsConfigured, createBuiltinAiSource } from './np-builtin-ai.js';

import type {
  BuiltinAgentEngine,
  BuiltinEngineSource,
} from '../modules/builtin/builtin.engine.js';
import type {
  AgentApi,
  BuiltinToolbox,
} from '../modules/builtin/builtin.toolbox.js';
import { BUILTIN_TOOLS } from '../modules/builtin/builtin.tools.js';

/** Registers the `np_*` tools with the plugin; every call goes to the tool box. */
class NpBuiltinTools extends AIResourceRegistrar {
  public constructor(private readonly toolbox: BuiltinToolbox) {
    super({ source: 'nocoproject' });
  }

  protected override async registerAIEmployees(
    _manager: AIEmployeeManager,
  ): Promise<void> {
    // NocoProject defines no AI employees.
  }

  protected override async registerTools(manager: ToolsManager): Promise<void> {
    await manager.registerTools(
      BUILTIN_TOOLS.map((tool) => ({
        scope: 'SPECIFIED' as const,
        execution: 'backend' as const,
        defaultPermission: 'ALLOW' as const,
        introduction: {
          title: `NocoProject: ${tool.name}`,
          about: tool.description,
        },
        definition: {
          name: tool.name,
          description: tool.description,
          schema: tool.schema,
        },
        invoke: async (
          ctx: { state?: { sessionId?: string } },
          args: unknown,
        ) => this.toolbox.invoke(ctx?.state?.sessionId, tool.name, args),
      })),
    );
  }
}

export async function registerBuiltinTools(
  ai: Parameters<AIResourceRegistrar['registerAIResources']>[0],
  toolbox: BuiltinToolbox,
): Promise<void> {
  await new NpBuiltinTools(toolbox).registerAIResources(ai);
}

/** The agent API in process: a request to the `/np/agent` router with the run token, no network. */
export function inProcessAgentApi(router: () => Hono): AgentApi {
  return {
    async request(token, request) {
      const url = new URL(`http://nocoproject.internal${request.path}`);
      for (const [key, value] of Object.entries(request.query ?? {}))
        if (value !== undefined) url.searchParams.set(key, String(value));
      const response = await router().request(url.toString(), {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(request.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON (Hono's plain 404): keep the text.
      }
      return { status: response.status, body };
    },
  };
}

interface HistoryRow {
  readonly createdAt?: string | null;
  readonly content?: {
    readonly metadata?: Record<string, unknown> | null;
  } | null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function engine(app: Application): BuiltinAgentEngine {
  const { container } = app;
  const logger = container.has(loggingToken)
    ? container.resolve(loggingToken).getLogger('nocoproject')
    : undefined;
  return {
    async createSession({ userId, title }) {
      const conversation = await container
        .resolve(aiConversationsManagerToken)
        .create({ userId, title, scope: 'nocoproject' });
      return String(conversation.sessionId);
    },
    async *run(request) {
      const factory = container.resolve(agentServiceFactoryToken);
      const agent = await factory.createAgent({
        sessionId: request.sessionId,
        model: { llmService: request.llmService, model: request.model },
        systemPrompt: request.systemPrompt,
        tools: request.tools,
        actor: { id: request.userId, roles: request.roles, isRoot: false },
        runtime: { logger } as never,
        checkpointer: factory.getMemorySaver(),
      });
      for await (const event of agent.stream({
        userMessages: [{ role: 'user', content: request.turnPrompt }],
        signal: request.signal,
      }))
        yield event;
    },
    async usage({ userId, sessionId, since }) {
      const { rows } = (await container
        .resolve(aiConversationsManagerToken)
        .getMessages({ userId, sessionId, paginate: false })) as {
        rows: readonly HistoryRow[];
      };
      let reported = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      for (const row of rows) {
        if (row.createdAt && new Date(row.createdAt) < since) continue;
        const usage = row.content?.metadata?.usage_metadata as
          | {
              input_tokens?: unknown;
              output_tokens?: unknown;
              input_token_details?: { cache_read?: unknown };
            }
          | undefined;
        if (
          !usage ||
          (usage.input_tokens === undefined &&
            usage.output_tokens === undefined)
        )
          continue;
        reported = true;
        inputTokens += count(usage.input_tokens);
        outputTokens += count(usage.output_tokens);
        cacheReadTokens += count(usage.input_token_details?.cache_read);
      }
      return { inputTokens, outputTokens, cacheReadTokens, reported };
    },
  };
}

/** Resolved at run time; null while the AI plugin is not registered. */
export function createBuiltinEngineSource(
  app: Application,
): BuiltinEngineSource {
  return () =>
    app.container.has(agentServiceFactoryToken) &&
    app.container.has(aiConversationsManagerToken)
      ? engine(app)
      : null;
}

const unmountedAgentApi: AgentApi = {
  request: async () => ({
    status: 503,
    body: { code: 'UNAVAILABLE', message: 'The agent API is not mounted yet.' },
  }),
};

/** `nocoproject.builtin` from `config.yml`; positive integers only. */
function builtinConfigOf(app: Application): Partial<BuiltinExecutorConfig> {
  const value = app.config.get<NocoProjectConfig>('nocoproject')?.builtin;
  const result: { maxConcurrent?: number; timeoutSeconds?: number } = {};
  for (const key of ['maxConcurrent', 'timeoutSeconds'] as const) {
    const n = value?.[key];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) result[key] = n;
  }
  return result;
}

type BuiltinServices = Pick<
  NpServices,
  'bus' | 'builtinToolbox' | 'builtinExecutor' | 'runtimes'
>;

/** The NocoProject provider's NP-219 part: what `createNpServices` gets, and the lifecycle hooks. */
export class NpBuiltinRuns {
  private agentApi: AgentApi | undefined;
  private release: (() => void) | undefined;

  public constructor(
    private readonly app: Application,
    private readonly logError: (error: unknown, message: string) => void,
  ) {}

  public serviceDeps(): Pick<
    NpServiceDeps,
    | 'aiConfigured'
    | 'builtinAi'
    | 'builtinEngine'
    | 'agentApi'
    | 'builtinConfig'
    | 'onBuiltinError'
  > {
    return {
      // An enabled service with an enabled model, the built-in runtimes' test (np-builtin-ai.ts).
      aiConfigured: () => aiModelsConfigured(this.app),
      builtinAi: createBuiltinAiSource(this.app),
      builtinEngine: createBuiltinEngineSource(this.app),
      // The agent router exists once `boot` built it.
      agentApi: () => this.agentApi ?? unmountedAgentApi,
      builtinConfig: builtinConfigOf(this.app),
      onBuiltinError: this.logError,
    };
  }

  /**
   * After the AI plugin's provider booted: mounts the in-process agent API, registers the `np_*` tools when the plugin
   * is there and wakes the executor whenever built-in work is queued.
   */
  public async boot(services: BuiltinServices): Promise<void> {
    // Imported here: the route contribution imports the provider's tokens.
    const { createNpAgentRouter } = await import('../routes/np-agent.js');
    let router: Hono | undefined;
    this.agentApi = inProcessAgentApi(
      () => (router ??= createNpAgentRouter(this.app)),
    );
    if (this.app.container.has(aiManagerToken))
      await registerBuiltinTools(
        this.app.container.resolve(aiManagerToken),
        services.builtinToolbox,
      );
    this.release = services.bus.subscribe((event) => {
      if (event.type === 'builtin.workAvailable')
        services.builtinExecutor.kick();
    });
  }

  /** One connectivity check per built-in runtime (§4.2, off the start path) and the runs queued while down. */
  public start(services: BuiltinServices): void {
    void services.runtimes
      .checkAllBuiltin()
      .catch((error: unknown) =>
        this.logError(error, 'NocoProject built-in runtime check failed.'),
      );
    services.builtinExecutor.kick();
  }

  /** The sweeper tick: the executor's fallback claim. */
  public tick(services: BuiltinServices): void {
    services.builtinExecutor.kick();
  }

  public async shutdown(services: BuiltinServices): Promise<void> {
    this.release?.();
    this.release = undefined;
    await services.builtinExecutor
      .close()
      .catch((error: unknown) =>
        this.logError(error, 'NocoProject built-in runs did not stop cleanly.'),
      );
  }
}
