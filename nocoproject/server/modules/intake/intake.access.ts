/**
 * Who may read a batch. NP-186: intake batches are history only; the writes are retired (`intake.routes.ts`).
 */
import type { Actor } from '../shared/activity.js';
import { NP_BUSINESS } from '../shared/access.js';
import { allowsOwn, scopeIn, viewerOf } from '../shared/authz.js';
import type { Conn } from '../shared/db.js';
import { notFound } from '../shared/errors.js';
import type { IntakeBatch } from '../shared/protocol.js';
import { findBatch } from './intake.records.js';

/**
 * The batch, if `intake/manage` reaches it: every batch, or those the caller entered (404 otherwise, so other members'
 * batches do not leak).
 */
export async function ownBatch(
  conn: Conn,
  actor: Actor,
  id: string,
): Promise<{ batch: IntakeBatch }> {
  const viewer = await viewerOf(conn, actor);
  const batch = await findBatch(conn, id);
  if (
    !allowsOwn(
      scopeIn(viewer, NP_BUSINESS.intake, 'manage'),
      batch.createdById,
      viewer.userId,
    )
  )
    throw notFound('Intake batch');
  return { batch };
}
