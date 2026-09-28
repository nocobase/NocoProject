// @vitest-environment node
/** NP-115: completing an issue never queues a project-manager summary, including legacy settings. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { NpServices } from '../../server/modules/services.ts';
import type {
  IssueV4,
  WorkspaceSettingsViewV4,
} from '../../server/modules/shared/protocol.ts';
import {
  ALICE,
  CAROL,
  buildServices,
  openNpTestDatabase,
  registerRuntime,
  resetData,
  rows,
  runRows,
  setRole,
  type NpTestDatabase,
} from './np-harness.ts';
import {
  browserApi4,
  createKindAgent,
  type ApiCall,
} from './np-iter4-harness.ts';

const opened = await openNpTestDatabase('np_t_executor_summary');
const skip = 'skip' in opened ? opened.skip : null;
if (skip) console.warn(`[np-executor-summary] skipped: ${skip}`);
const db = (skip ? null : opened) as NpTestDatabase | null;

afterAll(async () => {
  await db?.close();
});

let services: NpServices;
let carol: ApiCall;
let coder: string;
let manager: string;
type Data<T> = { data: T };

beforeEach(async () => {
  if (!db) return;
  await resetData(db);
  services = buildServices(db.database).services;
  await setRole(db, ALICE, 'member');
  await setRole(db, CAROL, 'owner');
  carol = browserApi4(services, CAROL);
  const coderRuntime = await registerRuntime(services, ALICE);
  const pmRuntime = await registerRuntime(services, CAROL, 'daemon-pm');
  coder = await createKindAgent(
    services,
    ALICE,
    coderRuntime.runtimeId,
    'Coder',
    'coder',
  );
  manager = await createKindAgent(
    services,
    CAROL,
    pmRuntime.runtimeId,
    'PM',
    'manager',
  );
});

async function setPm(): Promise<void> {
  await services.workspaceSettings.update(CAROL, { pmAgentId: manager });
}

describe.skipIf(!db)('executor summaries (PostgreSQL)', () => {
  async function doneBy(issue: IssueV4) {
    const current = (await services.issueQueries.detail(ALICE, issue.id)).issue;
    await services.issues.update(ALICE, issue.id, {
      statusKey: 'done',
      revision: current.revision,
    });
  }

  it.each(['human', 'system'] as const)(
    'does not enqueue a PM summary when an agent issue is completed by %s, even with the legacy setting enabled',
    async (completion) => {
      await setPm();
      // Simulate a stored setting from before NP-115, bypassing the normalized settings API.
      await db!.knex
        .withSchema(db!.schema)
        .table('system_settings')
        .update({
          settings: JSON.stringify({
            pmAgentId: manager,
            retrospectiveOnDone: true,
          }),
        });
      expect(
        (await services.workspaceSettings.view(CAROL)).retrospectiveOnDone,
      ).toBe(false);
      const issue = (await services.issues.create(ALICE, {
        title: 'Ship it',
        executor: { type: 'agent', id: coder },
      })) as IssueV4;
      const beforeRuns = await runRows(db!);
      if (completion === 'human') {
        await doneBy(issue);
      } else {
        await services.tx.run((tx) =>
          services.issues.systemSetStatus(tx, issue.id, 'done', {
            reason: 'prMerged',
          }),
        );
      }
      expect(await runRows(db!)).toHaveLength(beforeRuns.length);
      expect(await runRows(db!, `agent_id = '${manager}'`)).toEqual([]);
      expect(
        await rows(db!, 'activities', 'issue_id = ? AND action = ?', [
          issue.id,
          'retrospective_done',
        ]),
      ).toEqual([]);
    },
  );

  it('accepts the legacy settings field but cannot enable PM summaries', async () => {
    const result = await carol<Data<WorkspaceSettingsViewV4>>(
      'PATCH',
      '/np/settings',
      {
        retrospectiveOnDone: true,
      },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.retrospectiveOnDone).toBe(false);
  });

  it('skips issues no agent worked on, conversations, and a disabled setting', async () => {
    await setPm();
    const manual = (await services.issues.create(ALICE, {
      title: 'By hand',
    })) as IssueV4;
    await doneBy(manual);
    const { issueId } = await services.pm.conversation(ALICE, true);
    const conversation = (await services.issueQueries.detail(ALICE, issueId))
      .issue as unknown as IssueV4;
    await doneBy(conversation);
    await services.workspaceSettings.update(CAROL, {
      retrospectiveOnDone: false,
    });
    const coded = (await services.issues.create(ALICE, {
      title: 'Coded',
      executor: { type: 'agent', id: coder },
    })) as IssueV4;
    await doneBy(coded);
    expect(await runRows(db!, `agent_id = '${manager}'`)).toEqual([]);
  });
});
