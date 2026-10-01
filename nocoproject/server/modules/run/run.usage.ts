/** `runUsage` rows: token usage a run reported (daemon `complete`; NP-219: built-in runs, also when they fail). */
import type { Tx } from '../shared/db.js';
import { now } from '../shared/db.js';
import type { IdSource } from '../shared/ids.js';
import type { RunUsageInput } from '../shared/protocol.js';

/** One `runUsage` row (a completed run's report; NP-219: also a failed built-in run's). */
export async function insertRunUsage(
  conn: Tx['conn'],
  ids: IdSource,
  runId: string,
  usage: RunUsageInput,
): Promise<void> {
  await conn.query
    .insertInto('runUsage')
    .values({
      id: ids.next(),
      runId,
      provider: usage.provider,
      model: usage.model ?? null,
      inputTokens: Math.max(0, Math.trunc(usage.inputTokens || 0)),
      outputTokens: Math.max(0, Math.trunc(usage.outputTokens || 0)),
      cacheReadTokens: Math.max(0, Math.trunc(usage.cacheReadTokens ?? 0)),
      cacheWriteTokens: Math.max(0, Math.trunc(usage.cacheWriteTokens ?? 0)),
      createdAt: now(),
    })
    .execute();
}
