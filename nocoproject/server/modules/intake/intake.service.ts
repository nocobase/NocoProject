/**
 * Intake batches, read-only (NP-186). Until then a batch was created from pasted text (AI or rule-based drafts),
 * edited, refined and confirmed into issues; that is retired and the project manager plans work instead. The batches
 * and their drafts stay as history, and `originType = 'intake'` issues are unaffected.
 */
import type { Actor } from '../shared/activity.js';
import type { TxRunner } from '../shared/db.js';
import type {
  IntakeBatchAttachmentsField,
  IntakeBatchDetail,
} from '../shared/protocol.js';
import { intakeBatchAttachments } from '../attachment/attachment.intake.js';
import { ownBatch } from './intake.access.js';
import { draftsOf } from './intake.records.js';

/** The batch view carries the files that travelled with the batch. */
export type IntakeBatchDetailV4 = IntakeBatchDetail &
  IntakeBatchAttachmentsField;

export interface IntakeService {
  get(actor: Actor, id: string): Promise<IntakeBatchDetailV4>;
}

export interface IntakeDeps {
  readonly tx: TxRunner;
}

export function createIntakeService(deps: IntakeDeps): IntakeService {
  return {
    async get(actor, id) {
      const conn = deps.tx.read();
      const { batch } = await ownBatch(conn, actor, id);
      return {
        batch,
        drafts: await draftsOf(conn, id),
        attachments: await intakeBatchAttachments(conn, id),
      };
    },
  };
}
