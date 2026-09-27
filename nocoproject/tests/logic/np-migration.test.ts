// @vitest-environment node
/**
 * The Phase 0 migration and seed against a real PostgreSQL: up, indexes (including the partial pending-run index),
 * seed idempotency, down, and up again.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createMigrator, createSeeder } from '@nocobase/db';

import {
  MIGRATIONS_DIR,
  NP_TABLES,
  SEEDS_DIR,
  openNpTestDatabase,
  type NpTestDatabase,
} from './np-harness.ts';

const opened = await openNpTestDatabase('np_t_migration', { migrate: false });
const skip = 'skip' in opened ? opened.skip : null;
if (skip) console.warn(`[np-migration] skipped: ${skip}`);
const db = (skip ? null : opened) as NpTestDatabase | null;

afterAll(async () => {
  await db?.close();
});

async function tables(db: NpTestDatabase): Promise<string[]> {
  const result = await db.knex.raw(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
    [db.schema],
  );
  return (result as { rows: { table_name: string }[] }).rows.map(
    (row) => row.table_name,
  );
}

async function indexes(db: NpTestDatabase): Promise<Map<string, string>> {
  const result = await db.knex.raw(
    'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ?',
    [db.schema],
  );
  return new Map(
    (result as { rows: { indexname: string; indexdef: string }[] }).rows.map(
      (row) => [row.indexname, row.indexdef],
    ),
  );
}

describe.skipIf(!db)('NocoProject Phase 0 migration (PostgreSQL)', () => {
  const migrator = () =>
    createMigrator({
      database: db!.database,
      directory: MIGRATIONS_DIR,
      packageName: 'nocoproject',
    });
  const seeder = () =>
    createSeeder({
      database: db!.database,
      directory: SEEDS_DIR,
      packageName: 'nocoproject',
    });

  it('creates every table and the declared indexes', async () => {
    const result = await migrator().latest();
    expect(result.executed).toContain('2026092700001_np_phase0');
    expect(await tables(db!)).toEqual(expect.arrayContaining([...NP_TABLES]));

    const defs = await indexes(db!);
    expect(defs.get('np_runs_status_idx')).toContain('(status)');
    expect(defs.get('np_runs_agent_status_idx')).toContain(
      '(agent_id, status)',
    );
    expect(defs.get('np_runs_runtime_status_idx')).toContain(
      '(runtime_id, status)',
    );
    expect(defs.get('np_run_events_run_seq_unique')).toMatch(
      /UNIQUE.*\(run_id, seq\)/u,
    );
    expect(defs.get('np_run_sessions_unique')).toMatch(
      /UNIQUE.*\(agent_id, runtime_id, subject_type, subject_id\)/u,
    );
    expect(defs.get('np_runtimes_daemon_provider_unique')).toMatch(
      /UNIQUE.*\(daemon_id, provider\)/u,
    );
    expect(defs.get('np_run_tokens_hash_unique')).toMatch(/UNIQUE.*\(hash\)/u);
    expect(defs.get('np_issues_number_unique')).toMatch(/UNIQUE.*\(number\)/u);
    expect(defs.get('np_comments_issue_idx')).toContain('(issue_id)');
    expect(defs.get('np_activities_issue_idx')).toContain('(issue_id)');
    const pending = defs.get('np_runs_pending_unique') ?? '';
    expect(pending).toMatch(/UNIQUE.*COALESCE\(thread_scope/u);
    expect(pending).toContain('WHERE');
  });

  it('enforces one pending run per agent, subject and thread scope', async () => {
    const insert = (id: string, status: string, scope: string | null) =>
      db!.knex.raw(
        `INSERT INTO "${db!.schema}".runs (id, agent_id, status, subject_type, subject_id, thread_scope, created_at, updated_at)
         VALUES (?, 'a1', ?, 'issue', 'i1', ?, now(), now())`,
        [id, status, scope],
      );
    await insert('r1', 'queued', null);
    await expect(insert('r2', 'dispatched', null)).rejects.toThrow(
      /np_runs_pending_unique/u,
    );
    await insert('r3', 'queued', 'thread-1');
    await insert('r4', 'running', null);
    await insert('r5', 'completed', null);
    await db!.knex.raw(`DELETE FROM "${db!.schema}".runs`);
  });

  it('seeds the settings row once', async () => {
    await seeder().run();
    await db!.knex.raw(
      `UPDATE "${db!.schema}".system_settings SET issue_counter = 7`,
    );
    const again = await seeder().run();
    expect(again.executed).toEqual([]);
    const rows = (await db!.knex.raw(
      `SELECT * FROM "${db!.schema}".system_settings`,
    )) as {
      rows: { id: string; issue_prefix: string; issue_counter: number }[];
    };
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: 'default',
        issue_prefix: 'NP',
        issue_counter: 7,
      }),
    ]);
  });

  it('rolls back completely and applies again', async () => {
    const rolledBack = await migrator().rollback();
    expect(rolledBack.rolledBack).toContain('2026092700001_np_phase0');
    const remaining = await tables(db!);
    for (const table of NP_TABLES) expect(remaining).not.toContain(table);
    expect((await indexes(db!)).has('np_runs_pending_unique')).toBe(false);

    const again = await migrator().latest();
    expect(again.executed).toContain('2026092700001_np_phase0');
    expect((await indexes(db!)).has('np_runs_pending_unique')).toBe(true);
  });
});
