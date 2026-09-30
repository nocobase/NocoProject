/**
 * The files of intake batches, read-only since NP-186 (the AI draft tab is gone; the batch's files stay with the
 * batch as `npFiles.intakeBatchId`, and a batch still open keeps its files from the orphan sweep).
 */
import type { Conn } from '../shared/db.js';
import type { IntakeBatchAttachment } from '../shared/protocol.js';
import {
  contentPath,
  FILE_COLLECTION,
  toFileRow,
  type FileRow,
} from './attachment.records.js';

async function batchFiles(conn: Conn, batchId: string): Promise<FileRow[]> {
  const rows = await conn.query
    .selectFrom(FILE_COLLECTION)
    .selectAll()
    .where('intakeBatchId', '=', batchId)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.map(toFileRow);
}

/** The batch's files for its detail view (content paths without the application's base path). */
export async function intakeBatchAttachments(
  conn: Conn,
  batchId: string,
): Promise<IntakeBatchAttachment[]> {
  return (await batchFiles(conn, batchId)).map((file) => ({
    id: file.id,
    filename: file.filename,
    ext: file.ext,
    mimeType: file.mimeType,
    size: file.size,
    contentUrl: contentPath(file),
    issueId: file.issueId,
    readStatus: file.intakeReadStatus,
  }));
}

/** The ids of intake batches still open (their files are not orphans), among `batchIds`. */
export async function openBatchIds(
  conn: Conn,
  batchIds: readonly string[],
): Promise<Set<string>> {
  if (batchIds.length === 0) return new Set();
  const rows = await conn.query
    .selectFrom('intakeBatches')
    .select(['id', 'status'])
    .where('id', 'in', [...batchIds])
    .execute();
  return new Set(
    rows.filter((row) => row.status === 'draft').map((row) => String(row.id)),
  );
}
