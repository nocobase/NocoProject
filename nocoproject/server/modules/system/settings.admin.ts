/**
 * `GET/PATCH /np/settings` (docs/phase1/iteration-2-contract.md §I): every member reads the workspace settings;
 * owner/admin change them. `prMergedStatus` must be `'none'` or a status of the default workflow.
 */
import type { Actor } from '../shared/activity.js';
import { forbid, isAdmin, viewerOf } from '../shared/authz.js';
import type { Conn, TxRunner } from '../shared/db.js';
import { invalid } from '../shared/errors.js';
import type {
  ModelPrice,
  UpdateWorkspaceSettingsRequest,
  WorkspaceSettingsView,
} from '../shared/protocol.js';
import { validateBoolean } from '../shared/validate.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import type { SettingsService, WorkspaceSettings } from './settings.service.js';

const MAX_PRICES = 100;

export interface WorkspaceSettingsService {
  view(actor: Actor): Promise<WorkspaceSettingsView>;
  update(
    actor: Actor,
    patch: UpdateWorkspaceSettingsRequest,
  ): Promise<WorkspaceSettingsView>;
}

function priceNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw invalid('INVALID_MODEL_PRICE', `${field} must be a number ≥ 0.`);
  return value;
}

function priceText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128)
    throw invalid('INVALID_MODEL_PRICE', `${field} is required.`);
  return value.trim();
}

export function validateModelPrices(value: unknown): ModelPrice[] {
  if (!Array.isArray(value) || value.length > MAX_PRICES)
    throw invalid(
      'INVALID_MODEL_PRICE',
      `modelPrices must be an array of at most ${MAX_PRICES} prices.`,
    );
  return (value as unknown[]).map((item, index) => {
    const price = (item ?? {}) as Record<string, unknown>;
    const at = `modelPrices[${index}]`;
    return {
      provider: priceText(price.provider, `${at}.provider`),
      model: priceText(price.model, `${at}.model`),
      inputPerM: priceNumber(price.inputPerM, `${at}.inputPerM`),
      outputPerM: priceNumber(price.outputPerM, `${at}.outputPerM`),
      cacheReadPerM: priceNumber(
        price.cacheReadPerM ?? 0,
        `${at}.cacheReadPerM`,
      ),
      cacheWritePerM: priceNumber(
        price.cacheWritePerM ?? 0,
        `${at}.cacheWritePerM`,
      ),
    };
  });
}

async function patchValues(
  conn: Conn,
  workflows: WorkflowService,
  patch: UpdateWorkspaceSettingsRequest,
): Promise<Partial<WorkspaceSettings>> {
  const values: {
    -readonly [K in keyof WorkspaceSettings]?: WorkspaceSettings[K];
  } = {};
  if (patch.autoExecuteSubtasksDefault !== undefined)
    values.autoExecuteSubtasksDefault = validateBoolean(
      patch.autoExecuteSubtasksDefault,
      'autoExecuteSubtasksDefault',
    );
  if (patch.prMergedStatus !== undefined) {
    const status = patch.prMergedStatus;
    const view = await workflows.defaultView(conn);
    if (
      typeof status !== 'string' ||
      (status !== 'none' && !view.isKnown(status))
    )
      throw invalid(
        'INVALID_STATUS',
        "prMergedStatus must be 'none' or a status of the default workflow.",
      );
    values.prMergedStatus = status;
  }
  if (patch.intakeParser !== undefined) {
    if (patch.intakeParser !== 'auto' && patch.intakeParser !== 'heuristic')
      throw invalid('INVALID_FIELD', 'intakeParser must be auto or heuristic.');
    values.intakeParser = patch.intakeParser;
  }
  if (patch.modelPrices !== undefined)
    values.modelPrices = validateModelPrices(patch.modelPrices);
  return values;
}

export function createWorkspaceSettingsService(deps: {
  tx: TxRunner;
  settings: SettingsService;
  workflows: WorkflowService;
}): WorkspaceSettingsService {
  async function view(
    conn: Conn,
    actor: Actor,
  ): Promise<WorkspaceSettingsView> {
    const viewer = await viewerOf(conn, actor);
    return {
      ...(await deps.settings.read(conn)),
      issuePrefix: await deps.settings.issuePrefix(conn),
      canEdit: isAdmin(viewer),
    };
  }
  return {
    view: (actor) => view(deps.tx.read(), actor),
    async update(actor, patch) {
      await deps.tx.run(async (tx) => {
        if (!isAdmin(await viewerOf(tx.conn, actor)))
          forbid('Only an owner or admin may change the workspace settings.');
        const values = await patchValues(tx.conn, deps.workflows, patch ?? {});
        if (Object.keys(values).length > 0)
          await deps.settings.write(tx.conn, values);
      });
      return view(deps.tx.read(), actor);
    },
  };
}
