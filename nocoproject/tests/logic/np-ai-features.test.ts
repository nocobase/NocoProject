import { describe, expect, it, vi } from 'vitest';

import {
  describeFeature,
  pickModel,
  readAiFeature,
} from '../../server/modules/intake/ai-features.js';
import { selectProcess } from '../../server/modules/issue/process.js';
import { parseIntake } from '../../server/modules/intake/intake.parse.js';
import type { IntakeDeps } from '../../server/modules/intake/intake.service.js';
import { validateAiFeature } from '../../server/modules/system/settings.admin.js';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type WorkspaceSettings,
} from '../../server/modules/system/settings.service.js';

const CATALOG = [
  {
    llmService: 'smart',
    title: 'Smart',
    models: [{ label: 'Big', value: 'big' }],
  },
  {
    llmService: 'fast',
    title: 'Fast',
    models: [{ label: 'Flash', value: 'flash' }],
  },
];
const ON = { enabled: true, parser: 'auto', model: null } as const;

describe('AI feature models (NP-205)', () => {
  it('uses the chosen model, else the first one', () => {
    expect(
      pickModel(CATALOG, { llmService: 'fast', model: 'flash' }),
    ).toMatchObject({ source: 'setting', label: 'Flash' });
    expect(pickModel(CATALOG, null)).toMatchObject({
      source: 'default',
      ref: { llmService: 'smart', model: 'big' },
    });
    // A model removed from the services falls back to the default.
    expect(
      pickModel(CATALOG, { llmService: 'fast', model: 'gone' }),
    ).toMatchObject({ source: 'default' });
    expect(pickModel([], null)).toBeNull();
  });

  it('explains why a feature answers with rules', () => {
    expect(describeFeature(ON, CATALOG)).toMatchObject({
      active: true,
      fallback: null,
    });
    expect(describeFeature({ ...ON, enabled: false }, CATALOG).fallback).toBe(
      'disabled',
    );
    expect(
      describeFeature({ ...ON, parser: 'heuristic' }, CATALOG).fallback,
    ).toBe('rules_only');
    expect(describeFeature(ON, [])).toMatchObject({
      active: false,
      fallback: 'no_model',
      model: null,
    });
  });

  it('validates a saved feature', () => {
    expect(
      validateAiFeature(
        {
          enabled: false,
          parser: 'heuristic',
          model: { llmService: 'fast', model: 'flash' },
        },
        'intakeAi',
      ),
    ).toEqual({
      enabled: false,
      parser: 'heuristic',
      model: { llmService: 'fast', model: 'flash' },
    });
    expect(validateAiFeature(ON, 'intakeAi').model).toBeNull();
    expect(() => validateAiFeature({ enabled: 'yes' }, 'intakeAi')).toThrow();
    expect(() =>
      validateAiFeature({ ...ON, model: { llmService: 'x' } }, 'intakeAi'),
    ).toThrow();
  });
});

function fakeDeps(settings: Partial<WorkspaceSettings>) {
  const parseAs = vi.fn(async () => ({
    drafts: [{ position: 1, parentPosition: null, fields: { title: 'A' } }],
    sessionId: '',
  }));
  const deps = {
    settings: {
      read: async () => ({ ...DEFAULT_WORKSPACE_SETTINGS, ...settings }),
    },
    ai: { kind: 'ai', parseAs, refineAs: vi.fn(), parse: vi.fn() },
    aiConfigured: () => true,
    aiModels: { list: async () => CATALOG },
    heuristic: {
      kind: 'heuristic',
      parse: async () => [
        { position: 1, parentPosition: null, fields: { title: 'rule' } },
      ],
    },
  } as unknown as IntakeDeps;
  return { deps, parseAs };
}
const INPUT = { rawContent: 'x', project: null, workflow: null, labels: [] };

describe('running the parsers per feature (NP-205)', () => {
  it('sends each feature its own model', async () => {
    const { deps, parseAs } = fakeDeps({
      intakeAi: { ...ON, model: { llmService: 'fast', model: 'flash' } },
      breakdownAi: ON,
    });
    const conn = {} as never;
    await parseIntake(deps, conn, INPUT, 'u1', 'intakeAi');
    await parseIntake(deps, conn, INPUT, 'u1', 'breakdownAi');
    expect(
      parseAs.mock.calls.map(
        (call) => (call[0] as never as { model: unknown }).model,
      ),
    ).toEqual([
      { llmService: 'fast', model: 'flash' },
      { llmService: 'smart', model: 'big' },
    ]);
  });

  it('uses rules when the feature is off or rules only', async () => {
    const off = fakeDeps({ intakeAi: { ...ON, enabled: false } });
    expect(
      (await parseIntake(off.deps, {} as never, INPUT, 'u1', 'intakeAi'))
        .parser,
    ).toBe('heuristic');
    expect(off.parseAs).not.toHaveBeenCalled();
    const rules = fakeDeps({ breakdownAi: { ...ON, parser: 'heuristic' } });
    await parseIntake(rules.deps, {} as never, INPUT, 'u1', 'breakdownAi');
    expect(rules.parseAs).not.toHaveBeenCalled();
    // The other feature is unaffected.
    await parseIntake(rules.deps, {} as never, INPUT, 'u1', 'intakeAi');
    expect(rules.parseAs).toHaveBeenCalledTimes(1);
  });

  it('falls back to rules when no model is configured', async () => {
    const state = await readAiFeature(
      { read: async () => DEFAULT_WORKSPACE_SETTINGS } as never,
      { list: async () => [] },
      () => true,
      {} as never,
      'intakeAi',
    );
    expect(state.useModel).toBe(false);
  });
});

describe('the process classifier follows the new issue AI feature (NP-205)', () => {
  const classify = vi.fn(async () => ({
    process: 'direct' as const,
    by: 'heuristic' as const,
    rule: null,
  }));
  const run = (intakeAi: WorkspaceSettings['intakeAi']) =>
    selectProcess(
      {
        settings: {
          read: async () => ({ ...DEFAULT_WORKSPACE_SETTINGS, intakeAi }),
        } as never,
        classifier: { classify },
      },
      {} as never,
      { title: 't', description: 'd' },
      { userId: 'u1', useAi: true },
    );

  it('passes the feature model and honours its switch and parser', async () => {
    const model = { llmService: 'fast', model: 'flash' };
    await run({ ...ON, model });
    expect(classify).toHaveBeenLastCalledWith(expect.anything(), {
      userId: 'u1',
      useAi: true,
      model,
    });
    await run({ ...ON, enabled: false });
    expect(classify).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ useAi: false }),
    );
    await run({ ...ON, parser: 'heuristic' });
    expect(classify).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ useAi: false }),
    );
  });
});
