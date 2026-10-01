/**
 * The domain events of run changes: the invalidation events of every status change, and the wakeup of whoever claims
 * queued work (a daemon, or NP-219's built-in executor for built-in runtimes).
 */
import type { Tx } from '../shared/db.js';
import { str } from '../shared/db.js';
import type { RunStatus } from '../shared/protocol.js';

/** Emits the invalidation events every run status change produces. */
export function emitRunStatus(
  tx: Tx,
  run: { id: string; subjectId: string },
  status: RunStatus,
): void {
  tx.emit({
    type: 'run.status',
    runId: run.id,
    issueId: run.subjectId,
    status,
  });
  tx.emit({ type: 'issue.changed', issueId: run.subjectId });
  tx.emit({ type: 'agents.changed' });
}

/**
 * Tells the daemon that owns `runtimeId` that there is work to claim. NP-219: work on a built-in runtime goes to the
 * server's built-in executor instead; no daemon would claim it.
 */
export async function emitWorkAvailable(
  tx: Tx,
  runtimeId: string | null,
  runId?: string,
): Promise<void> {
  if (!runtimeId) return;
  const runtime = await tx.conn.query
    .selectFrom('runtimes')
    .select(['ownerUserId', 'runtimeType'])
    .where('id', '=', runtimeId)
    .executeTakeFirst();
  if (runtime?.runtimeType === 'builtin') {
    tx.emit({ type: 'builtin.workAvailable', ...(runId ? { runId } : {}) });
    return;
  }
  const userId = runtime ? str(runtime.ownerUserId) : null;
  if (userId) tx.emit({ type: 'daemon.workAvailable', userId, runtimeId });
}
