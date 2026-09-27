/**
 * Read models over issues: browser list, board and detail (filtered by what the caller may see), and the views an
 * agent sees through its run token.
 */
import type { Actor } from '../shared/activity.js';
import type { ApprovalGateway } from '../shared/approval.js';
import {
  hiddenProjectIds,
  requireVisibleIssue,
  viewerOf,
} from '../shared/authz.js';
import type { Conn, TxRunner } from '../shared/db.js';
import { fromJson, iso, num, str, unique } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type {
  Activity,
  ActorType,
  AgentContextResponseV1,
  IssueBoardResponse,
  IssueDetailV2,
  IssueForAgentV2,
  IssueListItemV2,
  IssueRunsResponse,
  IssueSubscriber,
  IssueV2,
  SubscriptionReason,
  SubtaskSummary,
} from '../shared/protocol.js';
import type { SettingsService } from '../system/settings.service.js';
import type { UserDirectory } from '../shared/users.js';
import type { CommentService } from '../collaboration/comment.service.js';
import { labelsForIssues } from '../label/label.service.js';
import { claimedPullRequests } from '../git/git.records.js';
import { claimedProject } from '../project/project.records.js';
import {
  activeRunCounts,
  agentNames,
  runSummariesForIssue,
} from '../run/run.queries.js';
import type { RunAuth } from '../run/token.js';
import { blockedCounts, blockersOf, childrenOf } from '../subtask/blocking.js';
import { dependenciesOf } from '../subtask/dependency.service.js';
import { proposalsFor } from '../subtask/proposal.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import {
  agentReadableIssue,
  detailExtras,
  queuedRunOf,
} from './issue.extras.js';
import { findIssue, issueRef, mapIssue } from './issue.records.js';

export interface IssueListFilter {
  readonly statusKey?: string | null;
  readonly projectId?: string | null;
  readonly q?: string | null;
  readonly labelId?: string | null;
  readonly ownerUserId?: string | null;
  readonly executorId?: string | null;
  /** An issue id, or `none` for top-level issues only. */
  readonly parentIssueId?: string | null;
}

export interface IssueQueries {
  list(actor: Actor, filter: IssueListFilter): Promise<IssueListItemV2[]>;
  board(actor: Actor, filter: IssueListFilter): Promise<IssueBoardResponse>;
  detail(actor: Actor, idOrKey: string): Promise<IssueDetailV2>;
  /** `GET /np/issues/:id/runs`: the issue's runs and the run queued behind the current turn. */
  runs(actor: Actor, idOrKey: string): Promise<IssueRunsResponse>;
  /** Any issue, unscoped (the caller already checked the run's scope). */
  forAgent(idOrKey: string): Promise<IssueForAgentV2>;
  /** An issue the run may read (iteration 2 §K: same project, or no project), else 404. */
  forAgentScoped(auth: RunAuth, idOrKey: string): Promise<IssueForAgentV2>;
  agentReadable(auth: RunAuth, idOrKey: string): Promise<IssueV2>;
  agentContext(auth: RunAuth): Promise<AgentContextResponseV1>;
  children(idOrKey: string): Promise<SubtaskSummary[]>;
}

export interface IssueQueryDeps {
  readonly tx: TxRunner;
  readonly users: UserDirectory;
  readonly workflows: WorkflowService;
  readonly settings: SettingsService;
  readonly comments: () => CommentService;
  readonly approvals: () => ApprovalGateway;
}

const LIST_LIMIT = 500;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

async function withNames(
  deps: IssueQueryDeps,
  conn: Conn,
  issues: readonly IssueV2[],
): Promise<IssueListItemV2[]> {
  const userNames = await deps.users.names(conn, [
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
  const ids = issues.map((issue) => issue.id);
  const counts = await activeRunCounts(conn, 'subjectId', ids);
  const labels = await labelsForIssues(conn, ids);
  const blocked = await blockedCounts(conn, deps.workflows, issues);
  const projectIds = unique(issues.map((issue) => issue.projectId));
  const projects = projectIds.length
    ? await conn.query
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('id', 'in', projectIds)
        .execute()
    : [];
  const projectNames = new Map(
    projects.map((row) => [str(row.id) ?? '', str(row.name) ?? '']),
  );
  const children = ids.length
    ? await conn.query
        .selectFrom('issues')
        .select((eb) => ['parentIssueId', eb.fn.countAll().as('count')])
        .where('parentIssueId', 'in', ids)
        .where('deletedAt', 'is', null)
        .groupBy('parentIssueId')
        .execute()
    : [];
  const childCounts = new Map(
    children.map((row) => [str(row.parentIssueId) ?? '', num(row.count)]),
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
    labels: labels.get(issue.id) ?? [],
    projectName: issue.projectId
      ? (projectNames.get(issue.projectId) ?? null)
      : null,
    subtaskCount: childCounts.get(issue.id) ?? 0,
    blockedCount: blocked.get(issue.id) ?? 0,
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

async function subscribers(
  conn: Conn,
  users: UserDirectory,
  issueId: string,
): Promise<IssueSubscriber[]> {
  const rows = await conn.query
    .selectFrom('issueSubscribers')
    .select(['userId', 'reason'])
    .where('issueId', '=', issueId)
    .where('unsubscribedAt', 'is', null)
    .orderBy('createdAt', 'asc')
    .execute();
  const names = await users.names(
    conn,
    rows.map((row) => str(row.userId)),
  );
  return rows.map((row) => {
    const userId = str(row.userId) ?? '';
    return {
      userId,
      name: names.get(userId) ?? userId,
      reason: (str(row.reason) ?? 'manual') as SubscriptionReason,
    };
  });
}

async function summaries(
  deps: IssueQueryDeps,
  conn: Conn,
  issues: readonly IssueV2[],
): Promise<SubtaskSummary[]> {
  const items = await withNames(deps, conn, issues);
  return items.map((item) => ({
    id: item.id,
    identifier: item.identifier,
    title: item.title,
    statusKey: item.statusKey,
    stage: item.stage,
    executorType: item.executorType,
    executorName: item.executorName,
    blockedCount: item.blockedCount,
  }));
}

async function forAgent(
  deps: IssueQueryDeps,
  idOrKey: string,
  auth?: RunAuth,
): Promise<IssueForAgentV2> {
  const conn = deps.tx.read();
  const issue = auth
    ? await agentReadableIssue(conn, auth, idOrKey)
    : await findIssue(conn, idOrKey);
  if (!issue) throw notFound('Issue');
  const [item] = await withNames(deps, conn, [issue]);
  const parent = issue.parentIssueId
    ? await findIssue(conn, issue.parentIssueId)
    : null;
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
    parentIssueId: issue.parentIssueId,
    parent: parent ? issueRef(parent) : null,
    projectId: issue.projectId,
    stage: issue.stage,
    autoExecuteSubtasks: issue.autoExecuteSubtasks,
    labels: (item?.labels ?? []).map((label) => label.name),
    blockers: await blockersOf(conn, deps.workflows, issue),
    executionMode: issue.executionMode,
    pullRequests: await claimedPullRequests(conn, issue.id),
  };
}

async function list(
  deps: IssueQueryDeps,
  actor: Actor,
  filter: IssueListFilter,
): Promise<IssueListItemV2[]> {
  const conn = deps.tx.read();
  const viewer = await viewerOf(conn, actor);
  const hidden = await hiddenProjectIds(conn, viewer);
  let query = conn.query
    .selectFrom('issues')
    .selectAll()
    .where('deletedAt', 'is', null);
  if (hidden.length > 0)
    query = query.where((eb) =>
      eb.or([eb('projectId', 'is', null), eb('projectId', 'not in', hidden)]),
    );
  if (filter.statusKey) query = query.where('statusKey', '=', filter.statusKey);
  if (filter.projectId) query = query.where('projectId', '=', filter.projectId);
  if (filter.ownerUserId)
    query = query.where('ownerUserId', '=', filter.ownerUserId);
  if (filter.executorId)
    query = query.where('executorId', '=', filter.executorId);
  if (filter.parentIssueId === 'none')
    query = query.where('parentIssueId', 'is', null);
  else if (filter.parentIssueId)
    query = query.where('parentIssueId', '=', filter.parentIssueId);
  if (filter.labelId) {
    const linked = await conn.query
      .selectFrom('issueLabelLinks')
      .select('issueId')
      .where('labelId', '=', filter.labelId)
      .execute();
    const ids = unique(linked.map((row) => str(row.issueId)));
    if (ids.length === 0) return [];
    query = query.where('id', 'in', ids);
  }
  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    query = query.where((eb) =>
      eb.or([eb('title', 'like', pattern), eb('identifier', 'like', pattern)]),
    );
  }
  const rows = await query
    .orderBy('lastActivityAt', 'desc')
    .orderBy('id', 'desc')
    .limit(LIST_LIMIT)
    .execute();
  return withNames(deps, conn, rows.map(mapIssue));
}

async function issueQueryBoard(
  deps: IssueQueryDeps,
  ...[actor, filter]: Parameters<IssueQueries['board']>
) {
  const issues = await list(deps, actor, filter);
  const conn = deps.tx.read();
  const view = await deps.workflows.forProject(conn, filter.projectId ?? null);
  const keys = view.catalog.map((entry) => entry.key);
  for (const issue of issues)
    if (!keys.includes(issue.statusKey)) keys.push(issue.statusKey);
  return {
    groups: keys.map((statusKey) => ({
      statusKey,
      issues: issues.filter((issue) => issue.statusKey === statusKey),
    })),
  };
}

async function issueQueryDetail(
  deps: IssueQueryDeps,
  ...[actor, idOrKey]: Parameters<IssueQueries['detail']>
) {
  const conn = deps.tx.read();
  const viewer = await viewerOf(conn, actor);
  const issue = await requireVisibleIssue(conn, viewer, idOrKey);
  const [item] = await withNames(deps, conn, [issue]);
  const view = await deps.workflows.forIssue(conn, issue);
  const parent = issue.parentIssueId
    ? await findIssue(conn, issue.parentIssueId)
    : null;
  const project = issue.projectId
    ? await conn.query
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('id', '=', issue.projectId)
        .executeTakeFirst()
    : null;
  const deps2 = await dependenciesOf(conn, issue.id);
  const extras = await detailExtras(deps, conn, issue);
  return {
    issue: item,
    comments: await deps.comments().listForIssue(conn, issue.id),
    activities: await activities(conn, deps.users, issue.id),
    runs: await runSummariesForIssue(conn, issue.id),
    statusCatalog: view.catalog,
    agentTransitions: view.agentTransitions,
    subtasks: await summaries(deps, conn, await childrenOf(conn, issue.id)),
    blockedBy: deps2.blockedBy,
    blocks: deps2.blocks,
    blockers: await blockersOf(conn, deps.workflows, issue),
    proposals: await proposalsFor(conn, issue.id),
    subscribers: await subscribers(conn, deps.users, issue.id),
    labels: item.labels,
    parent: parent ? issueRef(parent) : null,
    project: project
      ? { id: str(project.id) ?? '', name: str(project.name) ?? '' }
      : null,
    ...extras,
  };
}

async function issueQueryRuns(
  deps: IssueQueryDeps,
  ...[actor, idOrKey]: Parameters<IssueQueries['runs']>
) {
  const conn = deps.tx.read();
  const issue = await requireVisibleIssue(
    conn,
    await viewerOf(conn, actor),
    idOrKey,
  );
  return {
    data: await runSummariesForIssue(conn, issue.id),
    queuedRun: await queuedRunOf(conn, issue.id),
  };
}

async function issueQueryAgentContext(
  deps: IssueQueryDeps,
  ...[auth]: Parameters<IssueQueries['agentContext']>
) {
  const conn = deps.tx.read();
  const names = await agentNames(conn, [auth.agentId]);
  const issue = await forAgent(deps, auth.issueId);
  const view = await deps.workflows.forProject(conn, issue.projectId);
  return {
    run: { id: auth.runId },
    agent: { id: auth.agentId, name: names.get(auth.agentId) ?? '' },
    issue,
    statusCatalog: view.catalog,
    agentTransitions: view.agentTransitions,
    project: await claimedProject(conn, issue.projectId),
  };
}

async function issueQueryChildren(
  deps: IssueQueryDeps,
  ...[idOrKey]: Parameters<IssueQueries['children']>
) {
  const conn = deps.tx.read();
  const issue = await findIssue(conn, idOrKey);
  if (!issue) throw notFound('Issue');
  return summaries(deps, conn, await childrenOf(conn, issue.id));
}

export function createIssueQueries(deps: IssueQueryDeps): IssueQueries {
  return {
    list: (...args: Parameters<IssueQueries['list']>) => list(deps, ...args),
    forAgent: (idOrKey) => forAgent(deps, idOrKey),
    forAgentScoped: (auth, idOrKey) => forAgent(deps, idOrKey, auth),
    agentReadable: (auth, idOrKey) =>
      agentReadableIssue(deps.tx.read(), auth, idOrKey),
    runs: (...args) => issueQueryRuns(deps, ...args),
    board: (...args) => issueQueryBoard(deps, ...args),
    detail: (...args) => issueQueryDetail(deps, ...args),
    agentContext: (...args) => issueQueryAgentContext(deps, ...args),
    children: (...args) => issueQueryChildren(deps, ...args),
  };
}
