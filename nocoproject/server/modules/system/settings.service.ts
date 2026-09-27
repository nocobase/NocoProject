/**
 * The single `systemSettings` row: the issue prefix and the issue counter.
 */
import type { Conn } from '../shared/db.js';
import { isPostgres, knexOf, num, rawRows, str } from '../shared/db.js';

export const SETTINGS_ID = 'default';
const DEFAULT_PREFIX = 'NP';

export interface AllocatedIssueNumber {
  readonly number: number;
  readonly identifier: string;
}

export interface SettingsService {
  /**
   * Allocates the next issue number. Must run inside the caller's transaction: on PostgreSQL the counter row stays
   * locked by `UPDATE … RETURNING` until that transaction ends, so concurrent creates are serialized and numbers are
   * never reused — a rolled-back create releases its number.
   */
  allocateIssueNumber(conn: Conn): Promise<AllocatedIssueNumber>;
}

interface CounterRow {
  readonly issue_counter: unknown;
  readonly issue_prefix: unknown;
}

async function incrementPostgres(conn: Conn): Promise<CounterRow | undefined> {
  const knex = await knexOf(conn);
  const result: unknown = await knex.raw(
    'UPDATE system_settings SET issue_counter = issue_counter + 1, updated_at = now() ' +
      'WHERE id = ? RETURNING issue_counter, issue_prefix',
    [SETTINGS_ID],
  );
  return rawRows<CounterRow>(result)[0];
}

async function incrementPortable(conn: Conn): Promise<CounterRow | undefined> {
  // Other dialects: read-modify-write inside the caller's transaction. SQLite serializes writers, which is all the
  // non-PostgreSQL path (application smoke tests) needs.
  const row = await conn.query
    .selectFrom('systemSettings')
    .select(['issueCounter', 'issuePrefix'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst();
  if (!row) return undefined;
  const next = num(row.issueCounter) + 1;
  await conn.query
    .updateTable('systemSettings')
    .set({ issueCounter: next, updatedAt: new Date() })
    .where('id', '=', SETTINGS_ID)
    .execute();
  return { issue_counter: next, issue_prefix: row.issuePrefix };
}

export function createSettingsService(): SettingsService {
  return {
    async allocateIssueNumber(conn) {
      const increment = isPostgres(conn)
        ? incrementPostgres
        : incrementPortable;
      let row = await increment(conn);
      if (!row) {
        // The seed normally creates the row; recreate it rather than failing if it is missing.
        await conn.query
          .insertInto('systemSettings')
          .values({
            id: SETTINGS_ID,
            issuePrefix: DEFAULT_PREFIX,
            issueCounter: 0,
          })
          .execute();
        row = await increment(conn);
      }
      const number = num(row?.issue_counter);
      const prefix = str(row?.issue_prefix) || DEFAULT_PREFIX;
      return { number, identifier: `${prefix}-${number}` };
    },
  };
}
