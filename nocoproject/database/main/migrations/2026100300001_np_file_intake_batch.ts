// NP-78 follow-up: files uploaded on the AI 整理 tab travel with their intake batch until it is confirmed.
//
// npFiles.intakeBatchId: set when a batch is created with `attachmentIds`; the file stays unattached (`issueId`
// null) until the batch is confirmed, and the orphan purge leaves it alone while the batch is still a draft.
//
// Self-contained on purpose: every field is spelled out here and nothing is imported from server/modules, so the
// meaning of this migration never changes after it has run.
import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const ID = { length: 32 } as const;

const migration: MigrationDefinition = defineMigration({
  name: '2026100300001_np_file_intake_batch',

  async up({ builder }) {
    await builder.alterCollection('npFiles', (table) => {
      table.string('intakeBatchId', ID).nullable();
      table.index('intakeBatchId', { name: 'np_files_intake_batch_idx' });
    });
  },

  async down({ builder }) {
    // Two steps: within one alteration the column would go first, taking the index with it.
    await builder.alterCollection('npFiles', (table) => {
      table.dropIndex('np_files_intake_batch_idx');
    });
    await builder.alterCollection('npFiles', (table) => {
      table.dropFields('intakeBatchId');
    });
  },
});

export default migration;
