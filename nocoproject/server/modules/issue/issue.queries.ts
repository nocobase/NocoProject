/**
 * Read models over issues: browser list and detail, and the views an agent sees through its run token.
 */
import type { Conn, TxRunner } from '../shared/db.js';
import { fromJson, iso, str } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type {
  Activity,
  ActorType,
  AgentContextResponse,
  Issue,
  IssueDetail,
  IssueForAgent,
  IssueListItem,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import type { CommentService } from '../collaboration/comment.service.js';
import {
  activeRunCounts,
  agentNames,
  runSummariesForIssue,
} from '../run/run.queries.js';
import type { RunAuth } from '../run/token.js';
import { findIssue, mapIssue } from './issue.records.js';
import { AGENT_TRANSITIONS, STATUS_CATALOG } from './status.js';

export interface IssueListFilter {
  readonly statusKey?: string | null;
  readonly projectId?: string | null;
  readonly q?: string | null;
}

export interface IssueQueries {
  list(filter: IssueListFilter): Promise<IssueListItem[]>;
  detail(idOrKey: string): Promise<IssueDetail>;
  forAgent(idOrKey: string): Promise<IssueForAgent>;
  agentContext(auth: RunAuth): Promise<AgentContextResponse>;
}

export interface IssueQueryDeps {
  readonly tx: TxRunner;
  readonly users: UserDirectory;
  readonly comments: () => CommentService;
}

const LIST_LIMIT = 500;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

async function withNames(
  conn: Conn,
  users: UserDirectory,
  issues: readonly Issue[],
): Promise<IssueListItem[]> {
  const userNames = await users.names(conn, [
    ...issues.map((issue) => issue.ownerUserId),
    ...issues
      .filter((issue) => issue.executorType === 'user')
      .map((issue) => issue.executorId),
  ]);
  const agents = await agentNames(
    conn,
    issues
      .filter((issue) => issue.executorType === 'agent')
      .map((issue) => issue.executorId),
  );
  const counts = await activeRunCounts(
    conn,
    'subjectId',
    issues.map((issue) => issue.id),
  );
  return issues.map((issue) => ({
    ...issue,
    ownerName: issue.ownerUserId
      ? (userNames.get(issue.ownerUserId) ?? null)
      : null,
    executorName:
      issue.executorType === 'agent'
        ? (agents.get(issue.executorId ?? '') ?? null)
        : issue.executorType === 'user'
          ? (userNames.get(issue.executorId ?? '') ?? null)
          : null,
    activeRunCount: counts.get(issue.id) ?? 0,
  }));
}

async function activities(
  conn: Conn,
  users: UserDirectory,
  issueId: string,
): Promise<Activity[]> {
  const rows = await conn.query
    .selectFrom('activities')
    .selectAll()
    .where('issueId', '=', issueId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const userNames = await users.names(
    conn,
    rows
      .filter((row) => row.actorType === 'user')
      .map((row) => str(row.actorId)),
  );
  const agents = await agentNames(
    conn,
    rows
      .filter((row) => row.actorType === 'agent')
      .map((row) => str(row.actorId)),
  );
  return rows.map((row) => {
    const actorType = (str(row.actorType) ?? 'system') as ActorType;
    const actorId = str(row.actorId);
    const names = actorType === 'agent' ? agents : userNames;
    return {
      id: str(row.id) ?? '',
      issueId,
      actorType,
      actorId,
      actorName:
        actorType === 'system'
          ? 'system'
          : (names.get(actorId ?? '') ?? actorId ?? ''),
      action: str(row.action) ?? '',
      details: fromJson<Record<string, unknown>>(row.details),
      createdAt: iso(row.createdAt),
    };
  });
}

export function createIssueQueries(deps: IssueQueryDeps): IssueQueries {
  async function forAgent(idOrKey: string): Promise<IssueForAgent> {
    const conn = deps.tx.read();
    const issue = await findIssue(conn, idOrKey);
    if (!issue) throw notFound('Issue');
    const [item] = await withNames(conn, deps.users, [issue]);
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      statusKey: issue.statusKey,
      priority: issue.priority,
      ownerName: item?.ownerName ?? '',
      executor: {
        type: issue.executorType,
        id: issue.executorId,
        name: item?.executorName ?? null,
      },
    };
  }

  return {
    async list(filter) {
      const conn = deps.tx.read();
      let query = conn.query.selectFrom('issues').selectAll();
      if (filter.statusKey)
        query = query.where('statusKey', '=', filter.statusKey);
      if (filter.projectId)
        query = query.where('projectId', '=', filter.projectId);
      const q = filter.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        query = query.where((eb) =>
          eb.or([
            eb('title', 'like', pattern),
            eb('identifier', 'like', pattern),
          ]),
        );
      }
      const rows = await query
        .orderBy('lastActivityAt', 'desc')
        .orderBy('id', 'desc')
        .limit(LIST_LIMIT)
        .execute();
      return withNames(conn, deps.users, rows.map(mapIssue));
    },

    async detail(idOrKey) {
      const conn = deps.tx.read();
      const issue = await findIssue(conn, idOrKey);
      if (!issue) throw notFound('Issue');
      const [item] = await withNames(conn, deps.users, [issue]);
      return {
        issue: item,
        comments: await deps.comments().listForIssue(conn, issue.id),
        activities: await activities(conn, deps.users, issue.id),
        runs: await runSummariesForIssue(conn, issue.id),
        statusCatalog: STATUS_CATALOG,
      };
    },

    forAgent,

    async agentContext(auth) {
      const conn = deps.tx.read();
      const names = await agentNames(conn, [auth.agentId]);
      return {
        run: { id: auth.runId },
        agent: { id: auth.agentId, name: names.get(auth.agentId) ?? '' },
        issue: await forAgent(auth.issueId),
        statusCatalog: STATUS_CATALOG,
        agentTransitions: AGENT_TRANSITIONS,
      };
    },
  };
}
