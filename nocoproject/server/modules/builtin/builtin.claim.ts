/**
 * Claiming built-in runs (NP-219, protocol-runtime-types.md §6.2): the server's built-in executor takes queued runs of
 * type `builtin` with the same rules as `CLAIM_RUN_SQL` (agent not archived; no dispatched / running run of the agent
 * on the same subject; under `maxConcurrentRuns`; priority, then age; `FOR UPDATE SKIP LOCKED`), but without a runtime
 * filter and without requiring the runtime to be online: availability is decided before execution (§6.3). One
 * transaction-scoped advisory lock serializes built-in claims across application instances, for the same reason the
 * daemon claim locks per runtime. PostgreSQL only, like the daemon claim.
 */
import type { Tx } from '../shared/db.js';
import { knexOf, rawRows } from '../shared/db.js';
import type { IdSource } from '../shared/ids.js';
import { CLAIM_LEASE_SECONDS } from '../shared/protocol.js';
import { CLAIM_RUNTIME_LOCK_SQL, type ClaimedRow } from '../run/claim.sql.js';
import { emitRunStatus } from '../run/run.service.js';
import { issueRunToken } from '../run/token.js';

export const BUILTIN_CLAIM_LOCK_KEY = 'np:claim:builtin';

export const BUILTIN_CLAIM_RUN_SQL = `
UPDATE runs
   SET status = 'dispatched',
       dispatched_at = now(),
       lease_expires_at = now() + interval '${CLAIM_LEASE_SECONDS} seconds',
       runtime_id = (SELECT a.runtime_id FROM agents a WHERE a.id = runs.agent_id),
       updated_at = now()
 WHERE id = (
   SELECT r.id
     FROM runs r
     JOIN agents a ON a.id = r.agent_id
    WHERE r.status = 'queued'
      AND r.runtime_type = 'builtin'
      AND a.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM runs x
         WHERE x.agent_id = r.agent_id
           AND x.subject_type = r.subject_type
           AND x.subject_id = r.subject_id
           AND x.status IN ('dispatched', 'running'))
      AND (SELECT count(*) FROM runs y
            WHERE y.agent_id = r.agent_id
              AND y.status IN ('dispatched', 'running')) < a.max_concurrent_runs
    ORDER BY r.priority DESC, r.created_at ASC, r.id ASC
    FOR UPDATE OF r SKIP LOCKED
    LIMIT 1)
RETURNING id, agent_id, actor_user_id, subject_id`;

/** One built-in claim inside `tx`: the run (dispatched) and its token, or null when nothing is claimable. */
export async function claimBuiltinInTx(
  tx: Tx,
  ids: IdSource,
): Promise<{ runId: string; token: string } | null> {
  const knex = await knexOf(tx.conn);
  await knex.raw(CLAIM_RUNTIME_LOCK_SQL, [BUILTIN_CLAIM_LOCK_KEY]);
  const row = rawRows<ClaimedRow>(await knex.raw(BUILTIN_CLAIM_RUN_SQL))[0];
  if (!row) return null;
  const token = await issueRunToken(tx.conn, ids, {
    id: row.id,
    agentId: row.agent_id,
    actorUserId: row.actor_user_id,
  });
  emitRunStatus(tx, { id: row.id, subjectId: row.subject_id }, 'dispatched');
  return { runId: row.id, token };
}
