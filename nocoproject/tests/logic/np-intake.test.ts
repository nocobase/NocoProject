// @vitest-environment node
/**
 * Intake batches after NP-186: history only. A batch from before stays readable by its creator (and by whoever holds
 * `intake/manage` at owner scope); every write route answers 410 `INTAKE_RETIRED`; the manual form's `auto` process
 * is the heuristic alone. Real PostgreSQL.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { NpServices } from '../../server/modules/services.ts';
import {
  ALICE,
  BOB,
  buildServices,
  openNpTestDatabase,
  resetData,
  setRole,
  type NpTestDatabase,
} from './np-harness.ts';
import { browserApi4, type ApiCall } from './np-iter4-harness.ts';

const opened = await openNpTestDatabase('np_t_intake');
const skip = 'skip' in opened ? opened.skip : null;
if (skip) console.warn(`[np-intake] skipped: ${skip}`);
const db = (skip ? null : opened) as NpTestDatabase | null;

afterAll(async () => {
  await db?.close();
});

let services: NpServices;
let alice: ApiCall;
let bob: ApiCall;

/** A batch as the retired AI draft tab left it: two drafts, one of them confirmed into an issue. */
async function seedBatch(createdById: string): Promise<string> {
  const id = 'intake-batch-1';
  await db!.knex.raw(
    `INSERT INTO "${db!.schema}".intake_batches (id, created_by_id, source, raw_content, parser, status, created_at, updated_at)
     VALUES (?, ?, 'paste', '- One\n- Two', 'heuristic', 'confirmed', now(), now())`,
    [id, createdById],
  );
  for (const position of [1, 2]) {
    await db!.knex.raw(
      `INSERT INTO "${db!.schema}".intake_drafts (id, batch_id, position, fields, validation, created_at, updated_at)
       VALUES (?, ?, ?, ?::json, '{"errors":[]}'::json, now(), now())`,
      [
        `intake-draft-${position}`,
        id,
        position,
        JSON.stringify({ title: position === 1 ? 'One' : 'Two' }),
      ],
    );
  }
  return id;
}

describe.skipIf(!db)('intake batches, read-only (PostgreSQL)', () => {
  beforeEach(async () => {
    await resetData(db!);
    services = buildServices(db!.database).services;
    await setRole(db!, ALICE, 'member');
    await setRole(db!, BOB, 'member');
    alice = browserApi4(services, ALICE);
    bob = browserApi4(services, BOB);
  });

  it('still shows a batch from before to its creator, and to nobody else', async () => {
    const id = await seedBatch(ALICE.id!);
    const mine = await alice<{
      data: { batch: { id: string; status: string }; drafts: unknown[] };
    }>('GET', `/np/intake/batches/${id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.batch).toMatchObject({ id, status: 'confirmed' });
    expect(mine.body.data.drafts).toHaveLength(2);
    expect((await bob('GET', `/np/intake/batches/${id}`)).status).toBe(404);
  });

  it('answers 410 INTAKE_RETIRED on every write route', async () => {
    const id = await seedBatch(ALICE.id!);
    for (const [method, path] of [
      ['POST', '/np/intake/batches'],
      ['PUT', `/np/intake/batches/${id}/drafts`],
      ['POST', `/np/intake/batches/${id}/refine`],
      ['POST', `/np/intake/batches/${id}/confirm`],
      ['POST', `/np/intake/batches/${id}/cancel`],
    ] as const) {
      const response = await alice(method, path, {});
      expect(response.status, `${method} ${path}`).toBe(410);
      expect(response.body.code).toBe('INTAKE_RETIRED');
    }
  });
});
