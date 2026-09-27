/**
 * Batch claim for a daemon (protocol.md §4 `runs/claim`). Iteration 2 adds `agent.env` (decrypted — this payload only
 * travels on the daemon route), `agent.skills`, `issue.executionMode` and `issue.pullRequests`.
 *
 * Each claimed run is its own short transaction: runtime advisory lock → claim SQL → run token insert. The payload
 * for the daemon is assembled after commit; if that fails the run stays `dispatched` and the lease rule re-queues it.
 */
import type { SecretBox } from '../shared/crypto.js';
import type { Conn, Tx, TxRunner } from '../shared/db.js';
import {
  isArrayValue,
  isPostgres,
  knexOf,
  now,
  rawRows,
  str,
  unique,
} from '../shared/db.js';
import { forbidden, invalid, runtimeNotFound } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import {
  CLAIM_LEASE_SECONDS,
  PROTOCOL_VERSION,
  type AgentProvider,
  type ClaimedRun,
  type ClaimedRunPhase1Extras,
  type ClaimedRunPhase2Extras,
  type ClaimedTriggerComment,
  type DaemonClaimRequest,
  type DaemonClaimResponse,
  type RunTriggerType,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import { claimEnv } from '../agent/env.service.js';
import { claimedPullRequests } from '../git/git.records.js';
import { findIssue, issueRef } from '../issue/issue.records.js';
import { claimSkills } from '../skill/skill.service.js';
import { claimedProject } from '../project/project.records.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import {
  CLAIM_RUN_SQL,
  CLAIM_RUNTIME_LOCK_SQL,
  claimLockKey,
  type ClaimedRow,
} from './claim.sql.js';
import { findRun } from './run.records.js';
import { emitRunStatus } from './run.service.js';
import { findSession } from './sessions.js';
import { issueRunToken } from './token.js';

/** Upper bound on runs claimed per slot per request, whatever `free` says. */
const MAX_CLAIMS_PER_SLOT = 32;

export interface ClaimService {
  claim(
    ownerUserId: string,
    request: DaemonClaimRequest,
    serverUrl: string,
  ): Promise<DaemonClaimResponse>;
  /** One claim attempt for one runtime; exposed for the concurrency tests. */
  claimOne(runtimeId: string): Promise<{ runId: string; token: string } | null>;
}

export interface ClaimDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly workflows: WorkflowService;
  readonly secrets: SecretBox;
}

/** A claim payload with the iteration-1 extras merged in (contract §I). */
export type ClaimedRunV1 = ClaimedRun & ClaimedRunPhase1Extras;
/** ...and the iteration-2 extras (iteration-2 contract §L). */
export type ClaimedRunV2 = ClaimedRunV1 & ClaimedRunPhase2Extras;

async function delegationTargets(
  conn: Conn,
  agentId: string,
): Promise<{ id: string; name: string }[]> {
  const grants = await conn.query
    .selectFrom('agentDelegationGrants')
    .select('targetAgentId')
    .where('agentId', '=', agentId)
    .execute();
  const ids = unique(grants.map((row) => str(row.targetAgentId)));
  if (ids.length === 0) return [];
  const rows = await conn.query
    .selectFrom('agents')
    .select(['id', 'name'])
    .where('id', 'in', ids)
    .orderBy('name', 'asc')
    .execute();
  return rows.map((row) => ({
    id: str(row.id) ?? '',
    name: str(row.name) ?? '',
  }));
}

async function verifySlots(
  conn: Conn,
  ownerUserId: string,
  request: DaemonClaimRequest,
): Promise<string[]> {
  if (
    !request ||
    typeof request.daemonId !== 'string' ||
    !isArrayValue(request.slots)
  ) {
    throw invalid('INVALID_CLAIM', 'daemonId and slots are required.');
  }
  const runtimeIds = unique(request.slots.map((slot) => slot?.runtimeId));
  if (runtimeIds.length === 0) return [];
  const rows = await conn.query
    .selectFrom('runtimes')
    .select(['id', 'ownerUserId', 'daemonId'])
    .where('id', 'in', runtimeIds)
    .execute();
  for (const runtimeId of runtimeIds) {
    const row = rows.find((candidate) => candidate.id === runtimeId);
    // Unknown here (deleted, or registered under another daemon id) tells the daemon to register again.
    if (!row || row.daemonId !== request.daemonId)
      throw runtimeNotFound(runtimeId);
    if (row.ownerUserId !== ownerUserId) {
      throw forbidden(
        'RUNTIME_NOT_OWNED',
        `Runtime ${runtimeId} does not belong to this daemon.`,
      );
    }
  }
  return runtimeIds;
}

async function claimOneInTx(
  tx: Tx,
  ids: IdSource,
  runtimeId: string,
): Promise<{ runId: string; token: string } | null> {
  const knex = await knexOf(tx.conn);
  await knex.raw(CLAIM_RUNTIME_LOCK_SQL, [claimLockKey(runtimeId)]);
  const row = rawRows<ClaimedRow>(
    await knex.raw(CLAIM_RUN_SQL, [runtimeId, runtimeId]),
  )[0];
  if (!row) return null;
  const token = await issueRunToken(tx.conn, ids, {
    id: row.id,
    agentId: row.agent_id,
    actorUserId: row.actor_user_id,
  });
  emitRunStatus(tx, { id: row.id, subjectId: row.subject_id }, 'dispatched');
  return { runId: row.id, token };
}

async function triggerComments(
  conn: Conn,
  users: UserDirectory,
  commentIds: string[],
): Promise<Map<string, ClaimedTriggerComment>> {
  const result = new Map<string, ClaimedTriggerComment>();
  if (commentIds.length === 0) return result;
  const rows = await conn.query
    .selectFrom('comments')
    .selectAll()
    .where('id', 'in', commentIds)
    .execute();
  const userNames = await users.names(
    conn,
    rows
      .filter((row) => row.authorType === 'user')
      .map((row) => str(row.authorId)),
  );
  const agentIds = unique(
    rows
      .filter((row) => row.authorType === 'agent')
      .map((row) => str(row.authorId)),
  );
  const agentRows = agentIds.length
    ? await conn.query
        .selectFrom('agents')
        .select(['id', 'name'])
        .where('id', 'in', agentIds)
        .execute()
    : [];
  const agentNames = new Map(
    agentRows.map((row) => [str(row.id) ?? '', str(row.name) ?? '']),
  );
  for (const row of rows) {
    const id = str(row.id) ?? '';
    const authorId = str(row.authorId) ?? '';
    const authorName =
      row.authorType === 'agent'
        ? agentNames.get(authorId)
        : row.authorType === 'user'
          ? userNames.get(authorId)
          : 'system';
    result.set(id, {
      id,
      authorName: authorName ?? authorId,
      content: str(row.content) ?? '',
      parentId: str(row.parentId),
      rootId: str(row.rootId) ?? id,
    });
  }
  return result;
}

async function buildClaimedRun(
  deps: ClaimDeps,
  runId: string,
  token: string,
  serverUrl: string,
): Promise<ClaimedRunV2 | null> {
  const conn = deps.tx.read();
  const run = await findRun(conn, runId);
  if (!run || !run.runtimeId) return null;
  const agent = await conn.query
    .selectFrom('agents')
    .selectAll()
    .where('id', '=', run.agentId)
    .executeTakeFirst();
  const issue = await findIssue(conn, run.subjectId);
  if (!agent || !issue) return null;
  const ownerNames = await deps.users.names(conn, [issue.ownerUserId]);
  const triggerRows = await conn.query
    .selectFrom('runTriggers')
    .select(['type', 'commentId'])
    .where('runId', '=', runId)
    .orderBy('createdAt', 'asc')
    .execute();
  const comments = await triggerComments(
    conn,
    deps.users,
    unique(triggerRows.map((row) => str(row.commentId))),
  );
  const session = await findSession(conn, {
    agentId: run.agentId,
    runtimeId: run.runtimeId,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
  });
  const fresh = !session || session.poisoned || !session.providerSessionId;
  const view = await deps.workflows.forIssue(conn, issue);
  const parent = issue.parentIssueId
    ? await findIssue(conn, issue.parentIssueId)
    : null;
  return {
    run: {
      id: run.id,
      agentId: run.agentId,
      runtimeId: run.runtimeId,
      attempt: run.attempt,
      priority: run.priority,
      createdAt: run.createdAt,
    },
    token,
    agent: {
      id: run.agentId,
      name: str(agent.name) ?? '',
      instructions: str(agent.instructions) ?? '',
      provider: (str(agent.provider) ?? 'echo') as AgentProvider,
      model: str(agent.model),
      delegationTargets: await delegationTargets(conn, run.agentId),
      env: await claimEnv(conn, deps.secrets, run.agentId),
      skills: await claimSkills(conn, run.agentId),
    },
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      statusKey: issue.statusKey,
      ownerName: (issue.ownerUserId && ownerNames.get(issue.ownerUserId)) || '',
      parent: parent ? issueRef(parent) : null,
      stage: issue.stage,
      autoExecuteSubtasks: issue.autoExecuteSubtasks,
      projectId: issue.projectId,
      executionMode: issue.executionMode,
      pullRequests: await claimedPullRequests(conn, issue.id),
    },
    project: await claimedProject(conn, issue.projectId),
    statusCatalog: view.catalog,
    agentTransitions: view.agentTransitions,
    triggers: triggerRows.map((row) => {
      const comment = row.commentId
        ? comments.get(str(row.commentId) ?? '')
        : undefined;
      return comment
        ? { type: str(row.type) as RunTriggerType, comment }
        : { type: str(row.type) as RunTriggerType };
    }),
    session: {
      providerSessionId: fresh ? null : (session?.providerSessionId ?? null),
      workDir: session?.workDir ?? null,
      fresh,
      branchName: session?.branchName ?? null,
      repoUrl: session?.repoUrl ?? null,
    },
    server: { url: serverUrl, protocolVersion: PROTOCOL_VERSION },
    leaseSeconds: CLAIM_LEASE_SECONDS,
  };
}

export function createClaimService(deps: ClaimDeps): ClaimService {
  const claimOne = (runtimeId: string) =>
    deps.tx.run((tx) => claimOneInTx(tx, deps.ids, runtimeId));

  return {
    claimOne,
    async claim(ownerUserId, request, serverUrl) {
      const conn = deps.tx.read();
      if (!isPostgres(conn)) {
        throw invalid(
          'UNSUPPORTED_DIALECT',
          'Claiming runs requires PostgreSQL.',
        );
      }
      const runtimeIds = await verifySlots(conn, ownerUserId, request);
      if (runtimeIds.length > 0) {
        // A claim is proof of life for the runtimes it names.
        await conn.query
          .updateTable('runtimes')
          .set({ status: 'online', lastSeenAt: now(), updatedAt: now() })
          .where('id', 'in', runtimeIds)
          .execute();
      }
      const claimed: { runId: string; token: string }[] = [];
      for (const slot of request.slots) {
        const free = Math.min(
          Math.max(0, Math.trunc(Number(slot.free) || 0)),
          MAX_CLAIMS_PER_SLOT,
        );
        for (let index = 0; index < free; index += 1) {
          const result = await claimOne(slot.runtimeId);
          if (!result) break;
          claimed.push(result);
        }
      }
      const runs: ClaimedRunV2[] = [];
      for (const { runId, token } of claimed) {
        const payload = await buildClaimedRun(deps, runId, token, serverUrl);
        if (payload) runs.push(payload);
      }
      return { runs };
    },
  };
}
