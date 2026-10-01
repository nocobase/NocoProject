/**
 * NP-219: the built-in executor and its tool box (`builtin/`), built after the run modules it drives. The AI plugin
 * engine and the agent API come from the provider (`server/providers/np-builtin-agent.ts`); tests pass doubles.
 */
import {
  createBuiltinExecutor,
  type BuiltinExecutor,
  type BuiltinExecutorConfig,
  type BuiltinExecutorDeps,
} from './builtin/builtin.executor.js';
import type { BuiltinEngineSource } from './builtin/builtin.engine.js';
import {
  createBuiltinToolbox,
  type AgentApi,
  type BuiltinToolbox,
} from './builtin/builtin.toolbox.js';
import type { BuiltinAiSource } from './runtime/builtin-ai.js';
import { noBuiltinAi } from './runtime/builtin-ai.js';
import type { SecretBox } from './shared/crypto.js';
import type { TxRunner } from './shared/db.js';
import type { IdSource } from './shared/ids.js';
import type { UserDirectory } from './shared/users.js';
import type { WorkflowService } from './workflow/workflow.service.js';
import type { NpServices } from './services.js';

export interface BuiltinModuleInputs {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly workflows: WorkflowService;
  readonly secrets: SecretBox;
  readonly ai?: BuiltinAiSource;
  readonly engine?: BuiltinEngineSource;
  readonly agentApi?: () => AgentApi;
  readonly config?: Partial<BuiltinExecutorConfig>;
  readonly timers?: BuiltinExecutorDeps['timers'];
  readonly onError?: (error: unknown, message: string) => void;
}

const noAgentApi = (): AgentApi => ({
  request: async () => ({
    status: 503,
    body: { code: 'UNAVAILABLE', message: 'The agent API is not mounted.' },
  }),
});

export function createBuiltinModules(
  input: BuiltinModuleInputs,
  services: NpServices,
): { builtinToolbox: BuiltinToolbox; builtinExecutor: BuiltinExecutor } {
  const builtinToolbox = createBuiltinToolbox(input.agentApi ?? noAgentApi);
  const builtinExecutor = createBuiltinExecutor({
    tx: input.tx,
    ids: input.ids,
    claim: {
      tx: input.tx,
      ids: input.ids,
      users: input.users,
      workflows: input.workflows,
      secrets: input.secrets,
      knowledge: () => services.knowledge,
    },
    runs: services.runs,
    recovery: services.runRecovery,
    events: services.runEvents,
    ai: input.ai ?? noBuiltinAi,
    engine: input.engine ?? (() => null),
    toolbox: builtinToolbox,
    config: input.config,
    timers: input.timers,
    onError: input.onError,
  });
  return { builtinToolbox, builtinExecutor };
}
