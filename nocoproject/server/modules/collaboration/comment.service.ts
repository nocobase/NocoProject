/**
 * Comments on issues: human comments from the browser (which may trigger agents) and agent comments written back
 * through a run token (which never trigger anything).
 */
import type { Actor, ActivityRecorder } from '../shared/activity.js';
import {
  requireInvokeAgent,
  requireVisibleIssue,
  viewerOf,
} from '../shared/authz.js';
import type { Conn, TxRunner } from '../shared/db.js';
import { iso, now, str, toDate } from '../shared/db.js';
import { invalid, notFound } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type {
  ActorType,
  Comment,
  CommentForAgent,
  CreateCommentRequest,
  CreateCommentResponse,
} from '../shared/protocol.js';
import type { UserDirectory } from '../shared/users.js';
import { findIssue } from '../issue/issue.records.js';
import { agentNames } from '../run/run.queries.js';
import type { TriggerService } from '../trigger/trigger.service.js';
import { isNote, parseMentions, parseUserMentions } from './mentions.js';

const MAX_CONTENT_LENGTH = 200_000;

export interface AgentCommentQuery {
  /** Only comments created after this instant. */
  readonly since?: string | null;
  readonly rootsOnly?: boolean;
  /** Only this thread (root comment id). */
  readonly thread?: string | null;
  /** Only the last n comments of the result. */
  readonly tail?: number | null;
}

export interface CommentService {
  create(
    actor: Actor,
    issueIdOrKey: string,
    input: CreateCommentRequest,
  ): Promise<CreateCommentResponse>;
  /** Every comment of an issue, flat, oldest first. */
  listForIssue(conn: Conn, issueId: string): Promise<Comment[]>;
  listForAgent(
    issueIdOrKey: string,
    query: AgentCommentQuery,
  ): Promise<CommentForAgent[]>;
}

export interface CommentDeps {
  readonly tx: TxRunner;
  readonly ids: IdSource;
  readonly users: UserDirectory;
  readonly activity: ActivityRecorder;
  readonly triggers: () => TriggerService;
}

function isActorType(value: unknown): value is ActorType {
  return value === 'user' || value === 'agent' || value === 'system';
}

async function mapComments(
  conn: Conn,
  users: UserDirectory,
  rows: readonly Record<string, unknown>[],
): Promise<Comment[]> {
  const userIds = rows
    .filter((row) => row.authorType === 'user')
    .map((row) => str(row.authorId));
  const agentIds = rows
    .filter((row) => row.authorType === 'agent')
    .map((row) => str(row.authorId));
  const userNames = await users.names(conn, userIds);
  const agents = await agentNames(conn, agentIds);
  return rows.map((row) => {
    const id = str(row.id) ?? '';
    const authorType = isActorType(row.authorType) ? row.authorType : 'system';
    const authorId = str(row.authorId);
    const authorName =
      authorType === 'system'
        ? 'system'
        : ((authorType === 'agent' ? agents : userNames).get(authorId ?? '') ??
          authorId ??
          '');
    return {
      id,
      issueId: str(row.issueId) ?? '',
      authorType,
      authorId,
      authorName,
      content: str(row.content) ?? '',
      kind: row.kind === 'system' ? 'system' : 'comment',
      parentId: str(row.parentId),
      rootId: str(row.rootId) ?? id,
      sourceRunId: str(row.sourceRunId),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  });
}

async function create(
  deps: CommentDeps,
  actor: Actor,
  issueIdOrKey: string,
  input: CreateCommentRequest,
): Promise<CreateCommentResponse> {
  const content = typeof input?.content === 'string' ? input.content : '';
  if (content.trim() === '')
    throw invalid('INVALID_COMMENT', 'content is required.');
  if (content.length > MAX_CONTENT_LENGTH)
    throw invalid('INVALID_COMMENT', 'content is too long.');

  return deps.tx.run(async (tx) => {
    let issue;
    if (actor.type === 'user') {
      // Members see and comment on visible issues; mentioning an agent needs access to it (contract §B).
      const viewer = await viewerOf(tx.conn, actor);
      issue = await requireVisibleIssue(tx.conn, viewer, issueIdOrKey);
      if (!isNote(content))
        for (const agentId of parseMentions(content))
          await requireInvokeAgent(tx.conn, viewer.userId, agentId);
    } else {
      issue = await findIssue(tx.conn, issueIdOrKey);
    }
    if (!issue) throw notFound('Issue');
    let parent: Comment | null = null;
    if (input.parentId) {
      const parentRow = await tx.conn.query
        .selectFrom('comments')
        .selectAll()
        .where('id', '=', input.parentId)
        .executeTakeFirst();
      if (!parentRow || parentRow.issueId !== issue.id) {
        throw invalid(
          'INVALID_PARENT',
          'parentId must be a comment on the same issue.',
        );
      }
      parent = (await mapComments(tx.conn, deps.users, [parentRow]))[0] ?? null;
    }
    const id = deps.ids.next();
    const timestamp = now();
    const row = {
      id,
      issueId: issue.id,
      authorType: actor.type,
      authorId: actor.id,
      content,
      kind: 'comment',
      parentId: parent?.id ?? null,
      // The thread root is the parent's root: resolving it once at insert makes "topmost parent" a column read.
      rootId: parent?.rootId ?? id,
      sourceRunId: actor.runId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await tx.conn.query.insertInto('comments').values(row).execute();
    await tx.conn.query
      .updateTable('issues')
      .set({ lastActivityAt: timestamp })
      .where('id', '=', issue.id)
      .execute();
    await deps.activity.record(tx.conn, {
      issueId: issue.id,
      actor,
      action: 'comment_added',
      details: { commentId: id, parentId: row.parentId },
    });
    const comment = (await mapComments(tx.conn, deps.users, [row]))[0];
    const triggered = await deps
      .triggers()
      .onCommentCreated(tx, { comment, issue, parent, actor });
    tx.emit({ type: 'issue.changed', issueId: issue.id });
    tx.emit({
      type: 'comment.created',
      issueId: issue.id,
      commentId: id,
      actor: { type: actor.type, id: actor.id },
      mentionedUserIds: parseUserMentions(content),
    });
    return { comment, triggered };
  });
}

async function listForAgent(
  deps: CommentDeps,
  issueIdOrKey: string,
  query: AgentCommentQuery,
): Promise<CommentForAgent[]> {
  const conn = deps.tx.read();
  const issue = await findIssue(conn, issueIdOrKey);
  if (!issue) throw notFound('Issue');
  let select = conn.query
    .selectFrom('comments')
    .selectAll()
    .where('issueId', '=', issue.id);
  const since = query.since ? toDate(query.since) : null;
  if (query.since && !since)
    throw invalid('INVALID_SINCE', 'since must be an ISO 8601 timestamp.');
  if (since) select = select.where('createdAt', '>', since);
  if (query.thread) select = select.where('rootId', '=', query.thread);
  const rows = await select
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute();
  let comments = await mapComments(conn, deps.users, rows);
  if (query.rootsOnly)
    comments = comments.filter((comment) => comment.parentId === null);
  if (query.tail && query.tail > 0) comments = comments.slice(-query.tail);
  return comments.map((comment) => ({
    id: comment.id,
    authorType: comment.authorType,
    authorName: comment.authorName,
    content: comment.content,
    parentId: comment.parentId,
    rootId: comment.rootId,
    createdAt: comment.createdAt,
  }));
}

async function commentListForIssue(
  deps: CommentDeps,
  ...[conn, issueId]: Parameters<CommentService['listForIssue']>
) {
  const rows = await conn.query
    .selectFrom('comments')
    .selectAll()
    .where('issueId', '=', issueId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return mapComments(conn, deps.users, rows);
}

export function createCommentService(deps: CommentDeps): CommentService {
  return {
    create: (...args: Parameters<CommentService['create']>) =>
      create(deps, ...args),
    listForAgent: (...args: Parameters<CommentService['listForAgent']>) =>
      listForAgent(deps, ...args),
    listForIssue: (...args) => commentListForIssue(deps, ...args),
  };
}
