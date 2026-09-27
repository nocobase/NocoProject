// @temporary(nocobase-official): 待替换为 NocoBase 官方 活动流与变更事件
/**
 * Activity recorder: one row in `activities` per change to an issue, written in the caller's transaction so the
 * activity exists exactly when the change does.
 */
import type { Conn } from './db.js';
import { now, toJson } from './db.js';
import type { IdSource } from './ids.js';
import type { ActorType } from './protocol.js';

/** Who performed an operation. `runId` is set when an agent acts through a run token. */
export interface Actor {
  readonly type: ActorType;
  readonly id: string | null;
  readonly runId?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null };

export interface ActivityInput {
  readonly issueId: string;
  readonly actor: Actor;
  readonly action: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ActivityRecorder {
  record(conn: Conn, input: ActivityInput): Promise<void>;
}

export function createActivityRecorder(ids: IdSource): ActivityRecorder {
  return {
    async record(conn, input) {
      const details =
        input.actor.runId !== undefined
          ? { ...input.details, runId: input.actor.runId }
          : input.details;
      await conn.query
        .insertInto('activities')
        .values({
          id: ids.next(),
          issueId: input.issueId,
          actorType: input.actor.type,
          actorId: input.actor.id,
          action: input.action,
          details: toJson(details ?? null),
          createdAt: now(),
        })
        .execute();
    },
  };
}
