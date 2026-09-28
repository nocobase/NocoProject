// @vitest-environment node
/**
 * The Phase 2 migrations against a real PostgreSQL (NP-77 stage actions): up (the checklist table and its unique index,
 * the new proposal columns, a nullable proposing agent) and down (workflow suggestions removed, NOT NULL again).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createMigrator } from '@nocobase/db';

import {
  MIGRATIONS_DIR,
  NP_PHASE2_WORKFLOW_TABLES,
  openNpTestDatabase,
  type NpTestDatabase,
} from './np-harness.ts';

const opened = await openNpTestDatabase('np_t_migration_phase2', {
  migrate: false,
});
const skip = 'skip' in opened ? opened.skip : null;
if (skip) console.warn(`[np-migration-phase2] skipped: ${skip}`);
const db = (skip ? null : opened) as NpTestDatabase | null;

afterAll(async () => {
  await db?.close();
});

async function values(
  sql: string,
  params: readonly unknown[],
  column: string,
): Promise<string[]> {
  const result = await db!.knex.raw(sql, params as unknown[]);
  return (result as { rows: Record<string, string>[] }).rows.map(
    (row) => row[column],
  );
}

const tables = () =>
  values(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
    [db!.schema],
    'table_name',
  );
const columns = (_db: unknown, table: string) =>
  values(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
    [db!.schema, table],
    'column_name',
  );

async function indexes(): Promise<Map<string, string>> {
  const result = await db!.knex.raw(
    'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ?',
    [db!.schema],
  );
  return new Map(
    (result as { rows: { indexname: string; indexdef: string }[] }).rows.map(
      (row) => [row.indexname, row.indexdef],
    ),
  );
}

describe.skipIf(!db)('NocoProject Phase 2 migrations (PostgreSQL)', () => {
  const migrator = () =>
    createMigrator({
      database: db!.database,
      directory: MIGRATIONS_DIR,
      packageName: 'nocoproject',
    });

  it('rolls back the Phase 2 stage actions batch alone', async () => {
    while ((await migrator().rollback()).rolledBack.length > 0);
    await migrator().upTo('2026100100001_np_phase1_iter4');
    const applied = await migrator().upTo(
      '2026100200001_np_phase2_stage_actions',
    );
    expect(applied.executed).toEqual(['2026100200001_np_phase2_stage_actions']);
    expect(await tables()).toEqual(
      expect.arrayContaining([...NP_PHASE2_WORKFLOW_TABLES]),
    );
    expect((await indexes()).get('np_issue_checklist_items_unique')).toMatch(
      /UNIQUE.*\(issue_id, status_key, item_key\)/u,
    );
    expect(await columns(db!, 'executor_proposals')).toEqual(
      expect.arrayContaining(['source', 'stage_status_key']),
    );
    const insert = (id: string, source: string, by: string | null) =>
      db!.knex.raw(
        `INSERT INTO "${db!.schema}".executor_proposals (id, issue_id, proposed_agent_id, proposed_by_agent_id,
           status, source, created_at, updated_at)
         VALUES (?, 'i1', 'a1', ?, 'pending', ?, now(), now())`,
        [id, by, source],
      );
    await insert('p1', 'workflow', null);
    await insert('p2', 'agent', 'a2');
    const rolledBack = await migrator().rollback();
    expect(rolledBack.rolledBack).toEqual([
      '2026100200001_np_phase2_stage_actions',
    ]);
    expect(await tables()).not.toContain('issue_checklist_items');
    const proposalColumns = await columns(db!, 'executor_proposals');
    expect(proposalColumns).not.toContain('source');
    expect(proposalColumns).not.toContain('stage_status_key');
    const kept = await db!.knex.raw(
      `SELECT id FROM "${db!.schema}".executor_proposals ORDER BY id`,
    );
    expect((kept as { rows: { id: string }[] }).rows).toEqual([{ id: 'p2' }]);
    await expect(
      db!.knex.raw(
        `INSERT INTO "${db!.schema}".executor_proposals (id, issue_id, proposed_agent_id, proposed_by_agent_id,
           status, created_at, updated_at) VALUES ('p3', 'i1', 'a1', NULL, 'pending', now(), now())`,
      ),
    ).rejects.toThrow(/null value/u);
    await db!.knex.raw(`DELETE FROM "${db!.schema}".executor_proposals`);
    await migrator().latest();
  });
});
