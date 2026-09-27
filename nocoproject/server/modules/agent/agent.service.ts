/**
 * Agents: a named configuration (instructions, provider, model) bound to one runtime.
 *
 * TODO(Phase 1): `access` (ownerOnly | everyone) is stored but not enforced; Phase 0 only requires an authenticated
 * caller for every agent operation, and any signed-in user may assign or mention any agent.
 */
import type { Actor } from '../shared/activity.js';
import type { TxRunner } from '../shared/db.js';
import { iso, isoOrNull, now, num, str } from '../shared/db.js';
import { invalid, notFound } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type {
  Agent,
  AgentAccess,
  AgentListItem,
  AgentProvider,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '../shared/protocol.js';
import { activeRunCounts } from '../run/run.queries.js';
import { isAgentProvider, isOnline } from '../runtime/runtime.records.js';

export const DEFAULT_MAX_CONCURRENT_RUNS = 6;

export interface AgentService {
  list(): Promise<AgentListItem[]>;
  get(id: string): Promise<Agent>;
  create(actor: Actor, input: CreateAgentRequest): Promise<Agent>;
  update(actor: Actor, id: string, patch: UpdateAgentRequest): Promise<Agent>;
}

function mapAgent(row: Record<string, unknown>): Agent {
  return {
    id: str(row.id) ?? '',
    name: str(row.name) ?? '',
    description: str(row.description),
    ownerUserId: str(row.ownerUserId) ?? '',
    instructions: str(row.instructions) ?? '',
    runtimeId: str(row.runtimeId),
    provider: (str(row.provider) ?? 'echo') as AgentProvider,
    model: str(row.model),
    maxConcurrentRuns: num(row.maxConcurrentRuns, DEFAULT_MAX_CONCURRENT_RUNS),
    access: row.access === 'everyone' ? 'everyone' : 'ownerOnly',
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function validateName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > 255)
    throw invalid('INVALID_NAME', 'name is required (at most 255 characters).');
  return value;
}

function validateConcurrency(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 100
  ) {
    throw invalid(
      'INVALID_MAX_CONCURRENT_RUNS',
      'maxConcurrentRuns must be an integer between 1 and 100.',
    );
  }
  return value as number;
}

function validateAccess(value: unknown): AgentAccess {
  if (value !== 'ownerOnly' && value !== 'everyone')
    throw invalid('INVALID_ACCESS', 'access must be ownerOnly or everyone.');
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw invalid('INVALID_FIELD', `${field} must be a string.`);
  return value;
}

export interface AgentDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
}

async function requireRuntimeProvider(
  deps: AgentDeps,
  runtimeId: unknown,
  provider: AgentProvider,
): Promise<string> {
  if (typeof runtimeId !== 'string' || runtimeId === '')
    throw invalid('INVALID_RUNTIME', 'runtimeId is required.');
  const runtime = await deps.tx
    .read()
    .query.selectFrom('runtimes')
    .select(['id', 'provider'])
    .where('id', '=', runtimeId)
    .executeTakeFirst();
  if (!runtime) throw invalid('INVALID_RUNTIME', 'runtimeId does not exist.');
  if (runtime.provider !== provider) {
    throw invalid(
      'PROVIDER_MISMATCH',
      `Runtime ${runtimeId} runs ${String(runtime.provider)}, not ${provider}.`,
    );
  }
  return runtimeId;
}

async function getAgent(deps: AgentDeps, id: string): Promise<Agent> {
  const row = await deps.tx
    .read()
    .query.selectFrom('agents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Agent');
  return mapAgent(row);
}

async function listAgents(deps: AgentDeps): Promise<AgentListItem[]> {
  const conn = deps.tx.read();
  const agents = (
    await conn.query
      .selectFrom('agents')
      .selectAll()
      .orderBy('name', 'asc')
      .execute()
  ).map(mapAgent);
  const runtimeIds = Array.from(
    new Set(
      agents.map((agent) => agent.runtimeId).filter((id): id is string => !!id),
    ),
  );
  const runtimes = runtimeIds.length
    ? await conn.query
        .selectFrom('runtimes')
        .select(['id', 'name', 'status', 'lastSeenAt'])
        .where('id', 'in', runtimeIds)
        .execute()
    : [];
  const counts = await activeRunCounts(
    conn,
    'agentId',
    agents.map((agent) => agent.id),
  );
  return agents.map((agent) => {
    const runtime = runtimes.find((row) => row.id === agent.runtimeId);
    return {
      ...agent,
      runtimeName: runtime ? str(runtime.name) : null,
      runtimeOnline: runtime
        ? isOnline(runtime.status, runtime.lastSeenAt)
        : false,
      activeRunCount: counts.get(agent.id) ?? 0,
    };
  });
}

async function createAgent(
  deps: AgentDeps,
  actor: Actor,
  input: CreateAgentRequest,
): Promise<Agent> {
  const name = validateName(input?.name);
  if (!isAgentProvider(input.provider))
    throw invalid('INVALID_PROVIDER', 'provider is not supported.');
  if (typeof input.instructions !== 'string')
    throw invalid('INVALID_INSTRUCTIONS', 'instructions is required.');
  const runtimeId = await requireRuntimeProvider(
    deps,
    input.runtimeId,
    input.provider,
  );
  const timestamp = now();
  const id = deps.ids.next();
  await deps.tx.run(async (tx) => {
    await tx.conn.query
      .insertInto('agents')
      .values({
        id,
        name,
        description: optionalText(input.description, 'description'),
        ownerUserId: actor.id,
        instructions: input.instructions,
        runtimeId,
        provider: input.provider,
        model: optionalText(input.model, 'model'),
        maxConcurrentRuns:
          input.maxConcurrentRuns === undefined
            ? DEFAULT_MAX_CONCURRENT_RUNS
            : validateConcurrency(input.maxConcurrentRuns),
        access:
          input.access === undefined
            ? 'ownerOnly'
            : validateAccess(input.access),
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .execute();
    tx.emit({ type: 'agents.changed' });
  });
  return getAgent(deps, id);
}

async function updateAgent(
  deps: AgentDeps,
  _actor: Actor,
  id: string,
  patch: UpdateAgentRequest,
): Promise<Agent> {
  const current = await getAgent(deps, id);
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = validateName(patch.name);
  if (patch.description !== undefined)
    values.description = optionalText(patch.description, 'description');
  if (patch.instructions !== undefined) {
    if (typeof patch.instructions !== 'string')
      throw invalid('INVALID_INSTRUCTIONS', 'instructions must be a string.');
    values.instructions = patch.instructions;
  }
  if (patch.model !== undefined)
    values.model = optionalText(patch.model, 'model');
  if (patch.maxConcurrentRuns !== undefined)
    values.maxConcurrentRuns = validateConcurrency(patch.maxConcurrentRuns);
  if (patch.access !== undefined) values.access = validateAccess(patch.access);
  if (patch.provider !== undefined && !isAgentProvider(patch.provider)) {
    throw invalid('INVALID_PROVIDER', 'provider is not supported.');
  }
  if (patch.provider !== undefined || patch.runtimeId !== undefined) {
    const provider = patch.provider ?? current.provider;
    values.provider = provider;
    values.runtimeId = await requireRuntimeProvider(
      deps,
      patch.runtimeId ?? current.runtimeId,
      provider,
    );
  }
  if (patch.archived !== undefined)
    values.archivedAt = patch.archived ? (current.archivedAt ?? now()) : null;
  if (Object.keys(values).length === 0) return current;
  await deps.tx.run(async (tx) => {
    await tx.conn.query
      .updateTable('agents')
      .set({ ...values, updatedAt: now() })
      .where('id', '=', id)
      .execute();
    tx.emit({ type: 'agents.changed' });
  });
  return getAgent(deps, id);
}

export function createAgentService(deps: AgentDeps): AgentService {
  return {
    list: () => listAgents(deps),
    get: (id) => getAgent(deps, id),
    create: (actor, input) => createAgent(deps, actor, input),
    update: (actor, id, patch) => updateAgent(deps, actor, id, patch),
  };
}
