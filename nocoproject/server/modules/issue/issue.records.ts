/**
 * Row mapping and lookups for the `issues` table.
 */
import type { Conn } from '../shared/db.js';
import { iso, num, str, unique } from '../shared/db.js';
import type { ExecutorType, Issue, IssuePriority } from '../shared/protocol.js';

export const ISSUE_PRIORITIES: readonly IssuePriority[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];

const RUN_PRIORITY: Readonly<Record<IssuePriority, number>> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/** Numeric run priority derived from the issue priority (higher is claimed first). */
export function runPriorityOf(priority: IssuePriority): number {
  return RUN_PRIORITY[priority] ?? 0;
}

export function isIssuePriority(value: unknown): value is IssuePriority {
  return (
    typeof value === 'string' &&
    (ISSUE_PRIORITIES as readonly string[]).includes(value)
  );
}

export function isExecutorType(value: unknown): value is ExecutorType {
  return value === 'user' || value === 'agent' || value === 'none';
}

export function mapIssue(row: Record<string, unknown>): Issue {
  return {
    id: str(row.id) ?? '',
    number: num(row.number),
    identifier: str(row.identifier) ?? '',
    title: str(row.title) ?? '',
    description: str(row.description) ?? '',
    statusKey: str(row.statusKey) ?? '',
    priority: isIssuePriority(row.priority) ? row.priority : 'none',
    ownerUserId: str(row.ownerUserId),
    executorType: isExecutorType(row.executorType) ? row.executorType : 'none',
    executorId: str(row.executorId),
    parentIssueId: str(row.parentIssueId),
    projectId: str(row.projectId),
    revision: num(row.revision, 1),
    lastActivityAt: iso(row.lastActivityAt),
    createdById: str(row.createdById),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/u;

/** Finds an issue by id or by its identifier (`NP-12`). */
export async function findIssue(
  conn: Conn,
  idOrKey: string,
): Promise<Issue | null> {
  const byId = await conn.query
    .selectFrom('issues')
    .selectAll()
    .where('id', '=', idOrKey)
    .executeTakeFirst();
  if (byId) return mapIssue(byId);
  if (!IDENTIFIER_PATTERN.test(idOrKey)) return null;
  const byKey = await conn.query
    .selectFrom('issues')
    .selectAll()
    .where('identifier', 'in', unique([idOrKey, idOrKey.toUpperCase()]))
    .executeTakeFirst();
  return byKey ? mapIssue(byKey) : null;
}
