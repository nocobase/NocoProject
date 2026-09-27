/**
 * Projects: a flat grouping of issues in Phase 0.
 */
import type { TxRunner } from '../shared/db.js';
import { iso, now, str } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import type { IdSource } from '../shared/ids.js';
import type { Project } from '../shared/protocol.js';

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string | null;
}

export interface ProjectService {
  list(): Promise<Project[]>;
  create(input: CreateProjectInput): Promise<Project>;
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: str(row.id) ?? '',
    name: str(row.name) ?? '',
    description: str(row.description),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function createProjectService(deps: {
  tx: TxRunner;
  ids: IdSource;
}): ProjectService {
  return {
    async list() {
      const rows = await deps.tx
        .read()
        .query.selectFrom('projects')
        .selectAll()
        .orderBy('name', 'asc')
        .execute();
      return rows.map(mapProject);
    },
    async create(input) {
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 255)
        throw invalid(
          'INVALID_NAME',
          'name is required (at most 255 characters).',
        );
      if (
        input.description !== undefined &&
        input.description !== null &&
        typeof input.description !== 'string'
      ) {
        throw invalid('INVALID_DESCRIPTION', 'description must be a string.');
      }
      const timestamp = now();
      const row = {
        id: deps.ids.next(),
        name,
        description: input.description ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await deps.tx.read().query.insertInto('projects').values(row).execute();
      return mapProject(row);
    },
  };
}
