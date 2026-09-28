/**
 * Iteration 4 trigger rules (docs/phase1/iteration-4-contract.md §B, §C). Part of the trigger module: only
 * `trigger.service.ts` hands this file its enqueue functions.
 *
 * | Change                                                       | Result                                                    |
 * | ------------------------------------------------------------ | --------------------------------------------------------- |
 * | A member approves the design of an issue an agent executes   | enqueue for the executor, scope null, `designApproved` (carrying the approval comment) |
 * | An issue enters a done status | no summary run; the executor summarizes in its delivery comment (NP-115) |
 */
import type { Actor } from '../shared/activity.js';
import type { Tx } from '../shared/db.js';
import type { IssueV1, TriggeredRun } from '../shared/protocol.js';
import type { TriggerRecordInput } from '../run/run.service.js';
import type { EnqueueTarget } from './trigger.service.js';

export interface Iteration4TriggerDeps {
  readonly enqueue: (
    tx: Tx,
    target: EnqueueTarget,
    trigger: TriggerRecordInput,
  ) => Promise<TriggeredRun | null>;
}

/** The implementation run after a design approval. */
export async function designApprovedRun(
  deps: Iteration4TriggerDeps,
  tx: Tx,
  issue: IssueV1,
  actor: Actor,
  commentId: string | null,
): Promise<TriggeredRun[]> {
  if (issue.executorType !== 'agent' || !issue.executorId) return [];
  const actorUserId = actor.type === 'user' ? actor.id : issue.ownerUserId;
  const triggered = await deps.enqueue(
    tx,
    { issue, actorUserId, agentId: issue.executorId, threadScope: null },
    {
      type: 'designApproved',
      commentId,
      payload: { approvedById: actorUserId },
    },
  );
  return triggered ? [triggered] : [];
}
