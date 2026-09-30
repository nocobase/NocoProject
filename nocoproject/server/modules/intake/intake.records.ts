/**
 * Row mapping and reads for `intakeBatches` and `intakeDrafts`.
 */
import type { Conn } from '../shared/db.js';
import { fromJson, iso, isoOrNull, num, str } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type {
  IntakeBatch,
  IntakeBatchStatus,
  IntakeDraft,
  IntakeDraftFields,
} from '../shared/protocol.js';

const STATUSES: readonly IntakeBatchStatus[] = [
  'draft',
  'confirmed',
  'cancelled',
  'reverted',
];

export function mapBatch(row: Record<string, unknown>): IntakeBatch {
  const status = str(row.status) as IntakeBatchStatus;
  return {
    id: str(row.id) ?? '',
    createdById: str(row.createdById) ?? '',
    projectId: str(row.projectId),
    source: row.source === 'issue' ? 'issue' : 'paste',
    sourceIssueId: str(row.sourceIssueId),
    rawContent: str(row.rawContent) ?? '',
    parser: row.parser === 'ai' ? 'ai' : 'heuristic',
    status: STATUSES.includes(status) ? status : 'draft',
    aiSessionId: str(row.aiSessionId),
    confirmedAt: isoOrNull(row.confirmedAt),
    parseError: str(row.parseError),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function mapDraft(row: Record<string, unknown>): IntakeDraft {
  const validation = fromJson<{ errors?: unknown }>(row.validation);
  return {
    id: str(row.id) ?? '',
    batchId: str(row.batchId) ?? '',
    position: num(row.position),
    parentPosition:
      row.parentPosition === null || row.parentPosition === undefined
        ? null
        : num(row.parentPosition),
    fields: fromJson<IntakeDraftFields>(row.fields) ?? { title: '' },
    validation: {
      errors: Array.isArray(validation?.errors)
        ? validation.errors.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
    },
    createdIssueId: str(row.createdIssueId),
  };
}

export async function findBatch(conn: Conn, id: string): Promise<IntakeBatch> {
  const row = await conn.query
    .selectFrom('intakeBatches')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Intake batch');
  return mapBatch(row);
}

export async function draftsOf(
  conn: Conn,
  batchId: string,
): Promise<IntakeDraft[]> {
  const rows = await conn.query
    .selectFrom('intakeDrafts')
    .selectAll()
    .where('batchId', '=', batchId)
    .orderBy('position', 'asc')
    .execute();
  return rows.map(mapDraft);
}
